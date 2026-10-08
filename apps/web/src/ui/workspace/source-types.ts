export interface SourceRow {
  assetId: string;
  displayName: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  pageCount: number | null;
  verifiedAt: string | null;
  originalDeletedAt: string | null;
  selected: boolean;
  role: string;
  ranges: { start: number; end: number }[];
  timeStatus: string;
  contentVersionId: string | null;
  uploadId: string | null;
  uploadState: string | null;
  rejectionReason: string | null;
  anchorSourceId: string | null;
  captureOffsetMs: number | null;
  captureState: string | null;
}
