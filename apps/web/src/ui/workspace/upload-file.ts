import type { SourceKind } from "@recalino/core/src";
import type { RecordingStore } from "../recording/store";
import type { workspaceRequest } from "./api";
import { prepareFileHashes } from "./file-hashes";
import type { SourceRow } from "./source-types";
import { uploadSourceFileParts } from "./source-upload";
import type { UploadRecovery } from "./upload";
import type { UploadBatch, UploadEntry } from "./upload-store";

function kindOf(file: File): SourceKind | null {
  if (/\.(jpe?g|png|webp)$/i.test(file.name)) return "image";
  if (/\.pdf$/i.test(file.name)) return "pdf";
  if (/\.(html?|xhtml)$/i.test(file.name)) return "html";
  if (/\.txt$/i.test(file.name)) return "text";
  if (/\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)) return "audio";
  return null;
}
function mimeOf(file: File, kind: SourceKind) {
  if (kind === "text") return "text/plain";
  if (kind === "html") return "text/html";
  if (kind === "pdf") return "application/pdf";
  if (kind === "audio")
    return /\.m4a$/i.test(file.name)
      ? "audio/mp4"
      : /\.mp3$/i.test(file.name)
        ? "audio/mpeg"
        : /\.wav$/i.test(file.name)
          ? "audio/wav"
          : /\.ogg$/i.test(file.name)
            ? "audio/ogg"
            : "audio/webm";
  return /\.png$/i.test(file.name)
    ? "image/png"
    : /\.webp$/i.test(file.name)
      ? "image/webp"
      : "image/jpeg";
}
async function audioDuration(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  try {
    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      const cancel = () => finish(() => reject(signal?.reason));
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                "Audio duration could not be read. Use a supported file with duration metadata.",
              ),
            ),
          ),
        30_000,
      );
      const finish = (effect: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        audio.onloadedmetadata = audio.onerror = null;
        audio.src = "";
        effect();
      };
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        finish(() =>
          Number.isFinite(duration) && duration > 0
            ? resolve(Math.ceil(duration * 1000))
            : reject(
                new Error(
                  "This audio file has no readable duration. Use a supported file with duration metadata.",
                ),
              ),
        );
      };
      audio.onerror = () =>
        finish(() => reject(new Error("This browser cannot read that audio format.")));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      audio.src = url;
    });
  } finally {
    audio.onloadedmetadata = audio.onerror = null;
    URL.revokeObjectURL(url);
  }
}
async function convertHeic(file: File, maxPixels: number) {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > maxPixels)
      throw new Error("This image exceeds the pixel limit.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    context.drawImage(bitmap, 0, 0);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion unavailable"))),
        "image/jpeg",
        0.92,
      ),
    );
    return new File([jpeg], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
  } catch {
    throw new Error(
      "This browser cannot convert that HEIC photo. Convert it to JPEG, then add it again.",
    );
  } finally {
    bitmap?.close();
  }
}

export async function uploadQueuedFile(
  batch: UploadBatch,
  entry: UploadEntry,
  blob: Blob,
  deps: {
    request: typeof workspaceRequest;
    recordings: RecordingStore;
    recovery: UploadRecovery;
    patch(patch: Partial<UploadEntry>, persist?: boolean): Promise<void>;
  },
) {
  const { request, recovery, patch } = deps;
  recovery.signal?.throwIfAborted();
  let file = new File([blob], entry.displayName, {
    type: entry.mimeType,
    lastModified: entry.lastModified,
  });
  const contract = batch.contract;
  let converted = false;
  if (/\.(heic|heif)$/i.test(file.name) || ["image/heic", "image/heif"].includes(file.type)) {
    if (file.size > contract.formats.image.maxBytes)
      throw new Error("This image exceeds the source size limit.");
    file = await convertHeic(file, contract.formats.image.maxPixels ?? 0);
    converted = true;
  }
  const kind = kindOf(file);
  if (!kind) throw new Error("Choose audio, JPEG, PNG, WebP, PDF, HTML or plain text.");
  if (file.size <= 0 || file.size > contract.formats[kind].maxBytes)
    throw new Error("The file is empty or exceeds the source limit.");
  if (kind !== "audio" && !batch.storageConfigured)
    throw new Error("Private file storage has not been configured yet.");
  const started = performance.now();
  await patch({ phase: "checking", problem: undefined });
  const prepared = (!converted ? entry.prepared : undefined) ?? {
    ...(await prepareFileHashes(file, contract.partBytes, kind !== "audio", recovery.signal)),
    ...(kind === "audio" ? { durationMs: await audioDuration(file, recovery.signal) } : {}),
  };
  if (converted && entry.source && entry.prepared?.sha256 !== prepared.sha256)
    throw new Error(
      "The converted image changed on this device. Cancel this saved upload and add the photo again.",
    );
  if (prepared.durationMs && prepared.durationMs > (contract.formats.audio.maxDurationMs ?? 0))
    throw new Error("This audio file exceeds the duration limit.");
  await patch({ prepared, preparationMs: Math.round(performance.now() - started) }, true);
  const mimeType = mimeOf(file, kind);
  let source = entry.source;
  if (!source) {
    const matches = await request<
      {
        id: string;
        kind: string;
        uploadId: string | null;
        uploadState: string | null;
        original_deleted_at: string | null;
      }[]
    >(`/api/sources?checksum=${prepared.sha256}`, "GET");
    const resumable = matches.find(
      (candidate) =>
        candidate.kind === kind &&
        ["pending", "verifying"].includes(candidate.uploadState ?? "") &&
        candidate.uploadId &&
        !candidate.original_deleted_at,
    );
    const created = resumable
      ? { assetId: resumable.id, uploadId: resumable.uploadId }
      : await request<{ assetId: string; uploadId: string | null }>(
          "/api/sources",
          "POST",
          {
            sessionId: batch.sessionId,
            batchId: batch.id,
            fileId: entry.id,
            kind,
            mimeType,
            sizeBytes: file.size,
            sha256: prepared.sha256,
            displayName: file.name,
            ...(prepared.durationMs ? { durationMs: prepared.durationMs } : {}),
            parts: prepared.parts,
          },
          entry.creationKey,
        );
    if (resumable)
      await request(`/api/classes/${batch.sessionId}/sources`, "POST", {
        assetId: created.assetId,
        batchId: batch.id,
        fileId: entry.id,
      });
    source = {
      assetId: created.assetId,
      displayName: file.name,
      kind,
      mimeType,
      sizeBytes: file.size,
      durationMs: prepared.durationMs ?? null,
      pageCount: null,
      verifiedAt: null,
      originalDeletedAt: null,
      selected: kind === "audio",
      role: kind === "audio" ? "class_audio" : "class_material",
      ranges: [],
      timeStatus: "unknown",
      contentVersionId: null,
      uploadId: created.uploadId,
      uploadState: kind === "audio" ? null : "pending",
      rejectionReason: null,
      anchorSourceId: null,
      captureOffsetMs: null,
      captureState: null,
    } satisfies SourceRow;
    await patch({ source, sizeBytes: file.size }, true);
  }
  if (kind === "audio") {
    await patch({ phase: "saving" });
    const saved = await deps.recordings.get(batch.userId, source.assetId);
    if (saved?.bytes === file.size) {
      const original = await deps.recordings.blob(batch.userId, source.assetId);
      const fingerprint = await prepareFileHashes(
        original,
        contract.partBytes,
        false,
        recovery.signal,
      );
      if (fingerprint.sha256 !== prepared.sha256)
        throw new Error(
          "The saved audio does not match this file. Keep the original, cancel this upload and add the file again.",
        );
    }
    if (!saved || saved.bytes !== file.size) {
      if (saved?.bytes)
        throw new Error(
          "The saved audio differs from this file. Keep the original and add the file again.",
        );
      const now = new Date().toISOString();
      const manifest = saved ?? {
        id: source.assetId,
        userId: batch.userId,
        sessionId: batch.sessionId,
        mimeType,
        status: "saved" as const,
        createdAt: now,
        updatedAt: now,
        activeMs: prepared.durationMs ?? 0,
        chunks: 0,
        bytes: 0,
        creationKey: entry.creationKey,
        sourceAssetId: source.assetId,
      };
      if (!saved) await deps.recordings.put(manifest);
      await deps.recordings.append(manifest, file);
    }
  }
  if (!entry.registered) {
    await request(`/api/classes/${batch.sessionId}/learning`, "POST", {
      action: "register_file",
      batchId: batch.id,
      fileId: entry.id,
      sourceId: source.assetId,
    });
    await patch({ registered: true }, true);
  }
  if (kind === "audio") {
    await patch({ phase: "local_saved", sentBytes: 0, finishedAt: Date.now() }, true);
    return source.assetId;
  }
  if (!source.uploadId) throw new Error("The upload could not be created.");
  const transferStarted = performance.now();
  await patch({ phase: "uploading", sentBytes: 0 });
  await uploadSourceFileParts(
    {
      uploadId: source.uploadId,
      file,
      mimeType,
      partBytes: contract.partBytes,
      parts: prepared.parts,
      onProgress: (sentBytes) => {
        void patch({ sentBytes });
      },
    },
    { ...recovery, request },
  );
  await patch(
    {
      phase: "verifying",
      sentBytes: file.size,
      finishedAt: Date.now(),
      transferMs: Math.round(performance.now() - transferStarted),
      source: { ...source, uploadState: "verifying" },
    },
    true,
  );
  return source.assetId;
}
