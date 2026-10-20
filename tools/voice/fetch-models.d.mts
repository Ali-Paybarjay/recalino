export interface DownloadOptions {
  /** Replaces the global `fetch`; tests pass a fake. */
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** One attempt, headers and body together. Default 120 000. */
  timeoutMs?: number;
  /** Attempts before the build stops. Default 3. */
  attempts?: number;
  /** Wait after the first failed attempt; it doubles for each next one. Default 2 000. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Directory of verified downloads, named by SHA-256. A missing or tampered entry is ignored. */
  cacheDirectory?: string;
  log?: (message: string) => void;
}
export const DOWNLOAD_TIMEOUT_MS: number;
export const DOWNLOAD_ATTEMPTS: number;
export const DOWNLOAD_BACKOFF_MS: number;
export function fetchPinned(
  url: string,
  path: string,
  sha256: string,
  options?: DownloadOptions,
): Promise<void>;
export function provisionVoiceModels(
  root?: string,
  options?: DownloadOptions,
): Promise<{ revision: string; directory: string; verified: true }>;
