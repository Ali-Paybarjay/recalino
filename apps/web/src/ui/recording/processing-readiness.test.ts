import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pendingClassRecordings } from "./processing-readiness";
import type { Recording } from "./store";

const classId = randomUUID();
function row(patch: Partial<Recording> = {}): Recording {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: randomUUID(),
    sessionId: classId,
    creationKey: randomUUID(),
    sourceAssetId: randomUUID(),
    mimeType: "audio/webm",
    status: "saved",
    activeMs: 600000,
    chunks: 2,
    bytes: 1200,
    autoRegister: true,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
it("waits for live, unregistered and late final parts of the same class", () => {
  const live = row({ completedAt: undefined, status: "recording", bytes: 0 });
  const queued = row({ sourceAssetId: null });
  const late = row({ awaitingFinalData: true });
  expect(pendingClassRecordings([row(), live, queued, late], classId)).toEqual([
    live,
    queued,
    late,
  ]);
});
it("allows complete sources, legacy imports, empty terminal parts and other classes", () => {
  expect(
    pendingClassRecordings(
      [
        row(),
        row({ autoRegister: undefined, sourceAssetId: null, completedAt: undefined }),
        row({ bytes: 0, sourceAssetId: null }),
        row({ sessionId: randomUUID(), sourceAssetId: null }),
      ],
      classId,
    ),
  ).toEqual([]);
});
