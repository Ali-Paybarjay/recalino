import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RunSource } from "./contracts";
import { describeSourceIssues } from "./source-issues";

const source: RunSource = {
  sourceId: randomUUID(),
  kind: "pdf",
  sha256: "a".repeat(64),
  mimeType: "application/pdf",
  durationMs: null,
  pageCount: 8,
  objectId: randomUUID(),
  contentVersionId: randomUUID(),
  captureAnchor: null,
  ranges: [{ start: 2, end: 5 }],
  units: [
    { id: "page-2", kind: "page", start: 2, status: "extracted" },
    { id: "page-5", kind: "page", start: 5, status: "failed", reason: "unreadable" },
    { id: "page-8", kind: "page", start: 8, status: "failed", reason: "unreadable" },
  ],
  blocks: [{ id: "text-2", kind: "paragraph", text: "Readable content", unitId: "page-2" }],
};
const context = {
  name: "slides.pdf",
  order: 2,
  originalAvailable: true,
  currentSelection: true,
  knowledgeVersionId: randomUUID(),
  sourcesVersion: 7,
};

describe("version-specific material issue descriptions", () => {
  it("identifies the selected unreadable page and carries an exact extraction retry pin", () => {
    expect(describeSourceIssues(source, context)).toEqual([
      expect.objectContaining({
        name: "slides.pdf",
        order: 2,
        locator: "Page 5",
        action: "retry",
        recovery: {
          sourceId: source.sourceId,
          contentVersionId: source.contentVersionId,
          knowledgeVersionId: context.knowledgeVersionId,
          expectedSourcesVersion: 7,
        },
      }),
    ]);
    expect(JSON.stringify(describeSourceIssues(source, context))).not.toContain("Page 8");
  });
  it("does not describe a usable untimed transcript as lost or demand re-upload", () => {
    const issues = describeSourceIssues(
      {
        ...source,
        kind: "audio",
        ranges: [],
        units: [
          {
            id: "chunk-1",
            kind: "document",
            start: 1,
            status: "partial",
            reason: "timestamps_unavailable",
          },
        ],
      },
      { ...context, originalAvailable: false },
    );
    expect(issues[0]).toMatchObject({
      kind: "timing",
      action: "none",
      message: "Transcript available; timestamps unavailable.",
    });
    expect(issues[0]?.locator).toBeUndefined();
    expect(issues[0]?.recovery).toBeUndefined();
  });
  it("keeps historic warnings but prevents retrying a replacement extraction", () => {
    expect(describeSourceIssues(source, { ...context, currentSelection: false })[0]).toMatchObject({
      action: "review",
    });
    expect(
      describeSourceIssues(source, { ...context, currentSelection: false })[0]?.recovery,
    ).toBeUndefined();
  });
  it("names an unavailable original and chooses file recovery instead of retry", () => {
    expect(describeSourceIssues(source, { ...context, originalAvailable: false })[0]).toMatchObject(
      { name: "slides.pdf", action: "upload" },
    );
  });
  it("treats silent audio as a review decision instead of an upload failure", () => {
    expect(
      describeSourceIssues(
        {
          ...source,
          kind: "audio",
          ranges: [],
          units: [
            { id: "silent", kind: "document", start: 1, status: "failed", reason: "no_speech" },
          ],
        },
        context,
      )[0],
    ).toMatchObject({ kind: "empty", action: "review" });
  });
});
