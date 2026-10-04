// FR-PLT-014: the Vercel Blob implementation, the only file that imports its SDK (checked by
// dependency-cruiser). A private store in lhr1 (ADR-0001). Authentication comes from the
// environment: OIDC with BLOB_STORE_ID on Vercel, or BLOB_READ_WRITE_TOKEN.
import {
  BlobNotFoundError,
  completeMultipartUpload,
  createMultipartUpload,
  del,
  get,
  getDownloadUrl,
  head,
  issueSignedToken,
  list,
  presignUrl,
  put,
  uploadPart,
} from "@vercel/blob";
import type { ObjectStore, StoredObjectInfo } from "./storage";

export class VercelBlobStore implements ObjectStore {
  readonly name = "vercel-blob";

  async signWrite(
    key: string,
    limits: { contentType: string; maxBytes: number; validUntil: Date },
  ): Promise<string> {
    const token = await issueSignedToken({
      pathname: key,
      operations: ["put"],
      allowedContentTypes: [limits.contentType],
      maximumSizeInBytes: limits.maxBytes,
      validUntil: limits.validUntil.getTime(),
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname: key,
      access: "private",
      allowedContentTypes: [limits.contentType],
      maximumSizeInBytes: limits.maxBytes,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: limits.validUntil.getTime(),
    });
    return presignedUrl;
  }

  async signRead(key: string, validUntil: Date, options?: { download: boolean }): Promise<string> {
    const token = await issueSignedToken({
      pathname: key,
      operations: ["get"],
      validUntil: validUntil.getTime(),
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname: key,
      access: "private",
      validUntil: validUntil.getTime(),
    });
    return options?.download ? getDownloadUrl(presignedUrl) : presignedUrl;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await head(key);
      return {
        size: info.size,
        contentType: info.contentType,
        uploadedAt: info.uploadedAt,
        etag: info.etag,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    // Bypass the CDN cache: a check must see the latest write (Vercel Blob, consistent reads).
    const result = await get(key, { access: "private", useCache: false });
    if (result?.statusCode !== 200 || !result.stream) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await put(key, Buffer.from(bytes), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  async delete(key: string): Promise<void> {
    await del(key);
  }

  async list(prefix: string, cursor?: string) {
    const page = await list({ prefix, cursor, limit: 1000 });
    const objects = page.blobs.map((blob) => ({
      key: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    }));
    return page.hasMore && page.cursor ? { objects, cursor: page.cursor } : { objects };
  }

  /**
   * SPIKE-05, Q-SRC-4: joins chunk objects into one readable object, two ways, to compare them.
   * "stream" reads the chunks in order and writes one new object; "multipart" sends each chunk as
   * one part of a native multipart upload. ADR-0004 keeps one of them.
   */
  async compose(
    sourceKeys: readonly string[],
    targetKey: string,
    contentType: string,
    method: "stream" | "multipart",
  ): Promise<void> {
    const open = async (key: string) => {
      const result = await get(key, { access: "private", useCache: false });
      if (result?.statusCode !== 200 || !result.stream) throw new Error("chunk missing");
      return result.stream;
    };
    if (method === "stream") {
      const keys = [...sourceKeys];
      const joined = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const key = keys.shift();
          if (key === undefined) {
            controller.close();
            return;
          }
          const reader = (await open(key)).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        },
      });
      await put(targetKey, joined, {
        access: "private",
        contentType,
        multipart: true,
        addRandomSuffix: false,
      });
      return;
    }
    const upload = await createMultipartUpload(targetKey, {
      access: "private",
      contentType,
      addRandomSuffix: false,
    });
    const parts = [];
    for (const [index, key] of sourceKeys.entries()) {
      const bytes = Buffer.from(await new Response(await open(key)).arrayBuffer());
      parts.push(
        await uploadPart(targetKey, bytes, {
          access: "private",
          uploadId: upload.uploadId,
          key: upload.key,
          partNumber: index + 1,
        }),
      );
    }
    await completeMultipartUpload(targetKey, parts, {
      access: "private",
      uploadId: upload.uploadId,
      key: upload.key,
    });
  }
}
