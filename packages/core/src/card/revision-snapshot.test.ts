import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cardRevisionSnapshotSchema } from "./cards";

// QUA-05: card.revision.snapshot (read by undo) is parsed, not cast.
const written = {
  id: randomUUID(),
  ownerId: randomUUID(),
  learningItemId: randomUUID(),
  sessionIds: [randomUUID()],
  template: "basic",
  direction: "forward",
  front: "Synthetic front",
  back: "Synthetic back",
  provenance: { text: "Synthetic claim", origin: "from_class", sourceRefs: [] },
  status: "active",
  contentVersion: 2,
  important: false,
  qualityConfirmed: true,
  frontMediaId: null,
  backMediaId: null,
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  action: "edit",
};

describe("card revision snapshot (QUA-05)", () => {
  it("accepts a revision written before study metadata existed, unchanged", () => {
    expect(cardRevisionSnapshotSchema.parse(written)).toEqual(written);
  });
  it("keeps study metadata for savedStudyMetadata to validate, as before", () => {
    const withStudy = { ...written, contentFormat: "lesson_html", studyTags: ["x"], studySet: 1 };
    expect(cardRevisionSnapshotSchema.parse(withStudy)).toEqual(withStudy);
  });
  it("rejects a revision that lost a field undo restores", () => {
    for (const key of ["front", "back", "status", "important", "sessionIds"] as const) {
      const { [key]: _removed, ...rest } = written;
      expect(cardRevisionSnapshotSchema.safeParse(rest).success, key).toBe(false);
    }
    expect(cardRevisionSnapshotSchema.safeParse({ ...written, provenance: "text" }).success).toBe(
      false,
    );
  });
});
