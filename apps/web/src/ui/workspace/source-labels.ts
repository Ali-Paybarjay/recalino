/**
 * What a kind of uploaded file is called (UX-05): the words the upload page already uses
 * ("Choose audio, JPEG, PNG, WebP, PDF, HTML or plain text"; "Board photo"), never the stored kind.
 */
const KIND_LABELS: Record<string, string> = {
  audio: "Audio",
  image: "Photo",
  pdf: "PDF",
  html: "HTML",
  text: "Plain text",
};

export function sourceKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "File";
}
