import type { InputContract } from "@recalino/core/src";

export interface SelectedFile {
  id: string;
  file: File;
  problem?: string;
  invalid?: boolean;
}

/** Repeated picker visits add to the same queue without uploading or duplicating a file. */
export function appendSelectedFiles(
  previous: SelectedFile[],
  files: readonly File[],
): SelectedFile[] {
  const next = [...previous];
  for (const file of files) {
    if (
      next.some(
        (entry) =>
          entry.file.name === file.name &&
          entry.file.size === file.size &&
          entry.file.lastModified === file.lastModified &&
          entry.file.type === file.type,
      )
    )
      continue;
    next.push({ id: crypto.randomUUID(), file });
  }
  return next;
}

export function selectedFileProblem(file: File, contract: InputContract): string | undefined {
  const kind = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
    ? "image"
    : /\.pdf$/i.test(file.name)
      ? "pdf"
      : /\.(html?|xhtml)$/i.test(file.name)
        ? "html"
        : /\.txt$/i.test(file.name)
          ? "text"
          : /\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)
            ? "audio"
            : null;
  if (!kind)
    return "Unsupported file format. Replace it with audio, a photo, PDF, HTML or plain text.";
  if (file.size === 0) return "This file is empty. Choose a file with content.";
  const limit = contract.formats[kind].maxBytes;
  if (file.size > limit)
    return `This file is too large. Choose a smaller file (up to ${(limit / 1_000_000).toFixed(1)} MB).`;
  return undefined;
}
