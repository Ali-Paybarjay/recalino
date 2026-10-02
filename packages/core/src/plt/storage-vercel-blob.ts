// FR-PLT-014: the Vercel Blob implementation, the only file that imports its SDK (checked by
// dependency-cruiser). A private store in lhr1 (ADR-0001). Authentication comes from the
// environment: OIDC with BLOB_STORE_ID on Vercel, or BLOB_READ_WRITE_TOKEN.
import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  list,
  presignUrl,
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

  async signRead(key: string, validUntil: Date): Promise<string> {
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
    return presignedUrl;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await head(key);
      return { size: info.size, contentType: info.contentType, uploadedAt: info.uploadedAt };
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
}
