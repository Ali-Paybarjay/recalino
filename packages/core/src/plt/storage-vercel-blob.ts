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
import { errors } from "./errors";
import { DEFAULT_PLT_SETTINGS } from "./settings";
import type { ObjectStore, StoredObjectInfo } from "./storage";

export interface VercelBlobStoreOptions {
  /** PERF-05: the deadline of one request; `storage.blobTimeoutMs` in the PLT settings. */
  timeoutMs?: number;
}

export class VercelBlobStore implements ObjectStore {
  readonly name = "vercel-blob";
  readonly timeoutMs: number;

  constructor(options: VercelBlobStoreOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PLT_SETTINGS.storage.blobTimeoutMs;
  }

  /**
   * PERF-05: runs SDK calls with the request deadline. The SDK gets the abort signal, and the
   * call fails at the deadline even if a request ignores it, as the retryable storage_timeout.
   * `progress` restarts the deadline, so a long transfer only fails when it stops moving.
   */
  private async bounded<T>(
    call: (abortSignal: AbortSignal, progress: () => void) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let expire: (error: unknown) => void = () => {};
    const expired = new Promise<never>((_resolve, reject) => {
      expire = reject;
    });
    const progress = () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort();
        expire(errors.storageTimeout());
      }, this.timeoutMs);
    };
    progress();
    try {
      return await Promise.race([call(controller.signal, progress), expired]);
    } catch (error) {
      if (controller.signal.aborted) throw errors.storageTimeout();
      throw error;
    } finally {
      settled = true;
      clearTimeout(timer);
    }
  }

  async signWrite(
    key: string,
    limits: { contentType: string; maxBytes: number; validUntil: Date },
  ): Promise<string> {
    const token = await this.bounded((abortSignal) =>
      issueSignedToken({
        pathname: key,
        operations: ["put"],
        allowedContentTypes: [limits.contentType],
        maximumSizeInBytes: limits.maxBytes,
        validUntil: limits.validUntil.getTime(),
        abortSignal,
      }),
    );
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
    const token = await this.bounded((abortSignal) =>
      issueSignedToken({
        pathname: key,
        operations: ["get"],
        validUntil: validUntil.getTime(),
        abortSignal,
      }),
    );
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
      const info = await this.bounded((abortSignal) => head(key, { abortSignal }));
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
    // The body is read under the same deadline, restarted by each part that arrives.
    return this.bounded(async (abortSignal, progress) => {
      const result = await get(key, { access: "private", useCache: false, abortSignal });
      if (result?.statusCode !== 200 || !result.stream) return null;
      const parts: Uint8Array[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        progress();
      }
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    });
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bounded((abortSignal) =>
      put(key, Buffer.from(bytes), {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
        abortSignal,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.bounded((abortSignal) => del(key, { abortSignal }));
  }

  async list(prefix: string, cursor?: string) {
    const page = await this.bounded((abortSignal) =>
      list({ prefix, cursor, limit: 1000, abortSignal }),
    );
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
    const open = async (key: string, abortSignal: AbortSignal) => {
      const result = await get(key, { access: "private", useCache: false, abortSignal });
      if (result?.statusCode !== 200 || !result.stream) throw new Error("chunk missing");
      return result.stream;
    };
    if (method === "stream") {
      // One streamed upload of the whole class audio: the deadline restarts with every part read,
      // so only a transfer that stops moving fails, never a long one that keeps going.
      await this.bounded(async (abortSignal, progress) => {
        const keys = [...sourceKeys];
        const joined = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const key = keys.shift();
            if (key === undefined) {
              controller.close();
              return;
            }
            const reader = (await open(key, abortSignal)).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
              progress();
            }
          },
        });
        await put(targetKey, joined, {
          access: "private",
          contentType,
          multipart: true,
          addRandomSuffix: false,
          abortSignal,
        });
      });
      return;
    }
    const upload = await this.bounded((abortSignal) =>
      createMultipartUpload(targetKey, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        abortSignal,
      }),
    );
    const parts: Awaited<ReturnType<typeof uploadPart>>[] = [];
    for (const [index, key] of sourceKeys.entries()) {
      const bytes = await this.bounded(async (abortSignal) =>
        Buffer.from(await new Response(await open(key, abortSignal)).arrayBuffer()),
      );
      parts.push(
        await this.bounded((abortSignal) =>
          uploadPart(targetKey, bytes, {
            access: "private",
            uploadId: upload.uploadId,
            key: upload.key,
            partNumber: index + 1,
            abortSignal,
          }),
        ),
      );
    }
    await this.bounded((abortSignal) =>
      completeMultipartUpload(targetKey, parts, {
        access: "private",
        uploadId: upload.uploadId,
        key: upload.key,
        abortSignal,
      }),
    );
  }
}
