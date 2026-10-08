import { WorkspaceRequestError, workspaceRequest } from "./api";
import { retryUploadRequest, type UploadRecovery, uploadWithConfirmation } from "./upload";
import { concurrentUploads } from "./upload-concurrency";
import { uploadWithProgress } from "./upload-progress";

const interrupted = "Upload interrupted. Select the same file to resume.";

/** Use only for upload reads, stable source keys, attachments and batch-token mutations. */
export function createSourceUploadRequest(
  recovery: UploadRecovery,
  request: typeof workspaceRequest = workspaceRequest,
): typeof workspaceRequest {
  return <T>(
    path: string,
    method: string,
    body?: unknown,
    key?: string,
    options?: { signal?: AbortSignal },
  ) =>
    retryUploadRequest((signal) => request<T>(path, method, body, key, { signal }), interrupted, {
      attempts: 3,
      ...recovery,
      signal: options?.signal ?? recovery.signal,
    });
}

/** Checkpoint every part so a lost response or reselection never requires a blind repeated PUT. */
export async function uploadSourceFileParts(
  input: {
    uploadId: string;
    file: Blob;
    mimeType: string;
    partBytes: number;
    parts: readonly { index: number; sizeBytes: number }[];
    onProgress: (sentBytes: number) => void;
  },
  options: UploadRecovery & {
    request?: typeof workspaceRequest;
    put?: typeof uploadWithProgress;
  },
): Promise<void> {
  const api = options.request ?? workspaceRequest;
  const request = createSourceUploadRequest(options, api);
  const recovery = { attempts: 3, ...options };
  const path = `/api/sources/uploads/${input.uploadId}`;
  const manifest = await request<{
    state: string;
    parts: { index: number; verifiedAt: string | null }[];
  }>(path, "GET");
  if (["verified", "verifying"].includes(manifest.state)) {
    input.onProgress(input.file.size);
    return;
  }
  if (manifest.state !== "pending")
    throw new WorkspaceRequestError(
      "This upload is no longer available. Add the file again.",
      "conflict",
    );
  let confirmedBytes = input.parts.reduce(
    (sum, part) =>
      sum +
      (manifest.parts.some((saved) => saved.index === part.index && saved.verifiedAt)
        ? part.sizeBytes
        : 0),
    0,
  );
  input.onProgress(confirmedBytes);
  const inFlight = new Map<number, number>();
  const progress = () =>
    input.onProgress(
      confirmedBytes + [...inFlight.values()].reduce((sum, bytes) => sum + bytes, 0),
    );
  await concurrentUploads(
    input.parts.filter(
      (part) => !manifest.parts.some((saved) => saved.index === part.index && saved.verifiedAt),
    ),
    3,
    async (part) => {
      recovery.signal?.throwIfAborted();
      const partPath = `${path}/parts/${part.index}`;
      await uploadWithConfirmation(
        async (signal) => {
          // Signed links may expire while offline. Obtain a fresh link for each authorized write.
          const link = await api<{ url: string }>(partPath, "GET", undefined, undefined, {
            signal,
          });
          return (options.put ?? uploadWithProgress)(
            link.url,
            input.file.slice(part.index * input.partBytes, (part.index + 1) * input.partBytes),
            input.mimeType,
            (sentBytes) => {
              inFlight.set(part.index, Math.min(part.sizeBytes, Math.max(0, sentBytes)));
              progress();
            },
            signal,
          );
        },
        (signal) => api(partPath, "POST", undefined, undefined, { signal }),
        interrupted,
        { ...recovery, confirmBeforeWrite: true, confirmSuccess: true },
      );
      confirmedBytes += part.sizeBytes;
      inFlight.delete(part.index);
      progress();
    },
  );
  await request(`${path}/complete`, "POST", undefined, `source-complete:${input.uploadId}`);
}
