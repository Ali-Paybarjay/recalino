import "server-only";
import { type ObjectStore, readPltSettings } from "@recalino/core/plt";
import { VercelBlobStore } from "@recalino/core/plt/vercel-blob";

let store: ObjectStore | undefined;

/**
 * The file store (FR-PLT-014): Vercel Blob where a store is connected, which sets BLOB_STORE_ID
 * or BLOB_READ_WRITE_TOKEN. Null otherwise, e.g. in local development, where no feature uses
 * files yet; tests use MemoryObjectStore.
 */
export function getObjectStore(
  env: Record<string, string | undefined> = process.env,
): ObjectStore | null {
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) return null;
  // PERF-05: each request has the configured deadline (PLT_SETTINGS_JSON storage.blobTimeoutMs).
  store ??= new VercelBlobStore({ timeoutMs: readPltSettings(env).storage.blobTimeoutMs });
  return store;
}
