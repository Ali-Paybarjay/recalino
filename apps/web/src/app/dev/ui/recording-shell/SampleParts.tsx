"use client";
import { RecordedParts } from "../../../../ui/recording/RecordedParts";
import type { Recording } from "../../../../ui/recording/store";

/** Synthetic parts only (D107): no audio, no class data. */
const part = (segment: number, patch: Partial<Recording> = {}): Recording => ({
  id: `30000000-0000-4000-8000-00000000000${segment}`,
  userId: "10000000-0000-4000-8000-000000000002",
  sessionId: "10000000-0000-4000-8000-000000000001",
  captureId: "30000000-0000-4000-8000-000000000001",
  segment,
  creationKey: "40000000-0000-4000-8000-000000000001",
  sourceAssetId: null,
  autoRegister: true,
  autoGenerate: true,
  mimeType: "audio/webm",
  status: "saved",
  activeMs: 600_000,
  chunks: 1,
  bytes: 1,
  completedAt: "2026-10-20T10:00:00.000Z",
  createdAt: `2026-10-20T09:${segment}0:00.000Z`,
  updatedAt: "2026-10-20T10:00:00.000Z",
  ...patch,
});
const none = () => {};

/**
 * The recording page's list in each state, for comparing at 390 and 1440px: during capture (the
 * live part, no controls), after Stop (small controls, a part with missing minutes and one
 * still being added) and on /recordings without a recording.
 */
export function SampleParts({ state }: { state: "recording" | "saved" }) {
  if (state === "recording")
    return (
      <RecordedParts
        rows={[part(1), part(2, { completedAt: undefined, status: "recording" })]}
        phase="recording"
        live={{ id: part(2).id, ms: 154_000, recovering: false }}
      />
    );
  return (
    <RecordedParts
      rows={[
        part(1, { sourceAssetId: "a" }),
        part(2, {
          sourceAssetId: "b",
          gaps: [
            {
              from: "2026-10-20T09:25:00.000Z",
              to: "2026-10-20T09:27:00.000Z",
              offsetMs: 300_000,
              missingMs: 120_000,
              cause: "stalled",
            },
          ],
        }),
        part(3, { activeMs: 222_000 }),
      ]}
      phase="saved"
      actions={{ listen: none, exportAudio: none, remove: none }}
    />
  );
}
