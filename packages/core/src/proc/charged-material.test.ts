import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { amounts } from "../quota";
import { type ChargedCoverage, chargeableAmounts } from "./charged-material";
import type { RunSource } from "./contracts";

const audioSha = "a".repeat(64);
const pdfSha = "b".repeat(64);
function source(partial: Partial<RunSource> & Pick<RunSource, "kind" | "sha256">): RunSource {
  return {
    sourceId: randomUUID(),
    mimeType: "application/octet-stream",
    durationMs: null,
    pageCount: null,
    objectId: null,
    contentVersionId: null,
    captureAnchor: null,
    ranges: [],
    units: [],
    blocks: [],
    ...partial,
  };
}
const recording = source({ kind: "audio", sha256: audioSha, durationMs: 7_675_883 });
const covered = (
  kind: RunSource["kind"],
  sha256: string,
  whole: boolean,
  spans: [number, number][] = [],
): ChargedCoverage => new Map([[`${kind}:${sha256}`, { whole, spans }]]);

describe("D59 charge-once amounts (FR-QUOTA-004, FR-QUOTA-006)", () => {
  it("charges the full selection when nothing was paid for, as the confirmed estimate", () => {
    const text = source({
      kind: "text",
      sha256: "c".repeat(64),
      blocks: [{ id: "b", kind: "paragraph", unitId: "u", text: "x".repeat(2500) }],
    });
    const photo = source({ kind: "image", sha256: "d".repeat(64) });
    const pdf = source({
      kind: "pdf",
      sha256: pdfSha,
      pageCount: 9,
      ranges: [
        { start: 2, end: 4 },
        { start: 7, end: 7 },
      ],
    });
    expect(chargeableAmounts([recording, text, photo, pdf], new Map(), 1000, false)).toEqual(
      amounts({ audio: 7676, document: 3 + 1 + 4 }),
    );
  });

  it("charges nothing again for a whole recording this class or period already paid for", () => {
    expect(chargeableAmounts([recording], covered("audio", audioSha, true), 1000, false)).toEqual(
      amounts({}),
    );
    // A shorter or remeasured whole file and any part of it stay paid for.
    const remeasured = source({ kind: "audio", sha256: audioSha, durationMs: 7_675_763 });
    const part = source({
      kind: "audio",
      sha256: audioSha,
      durationMs: 7_675_883,
      ranges: [{ start: 60_000, end: 120_000 }],
    });
    expect(
      chargeableAmounts([remeasured, part], covered("audio", audioSha, true), 1000, false),
    ).toEqual(amounts({}));
  });

  it("charges only the unpaid seconds when a selected part is extended", () => {
    const extended = source({
      kind: "audio",
      sha256: audioSha,
      durationMs: 7_675_883,
      ranges: [{ start: 0, end: 90_000 }],
    });
    expect(
      chargeableAmounts([extended], covered("audio", audioSha, false, [[0, 60_000]]), 1000, false),
    ).toEqual(amounts({ audio: 30 }));
    // A whole-file selection after a paid part pays for the rest of the file only.
    expect(
      chargeableAmounts([recording], covered("audio", audioSha, false, [[0, 60_000]]), 1000, false),
    ).toEqual(amounts({ audio: Math.ceil((7_675_883 - 60_000) / 1000) }));
  });

  it("counts identical content and overlapping ranges once in the same run", () => {
    const again = { ...recording, sourceId: randomUUID() };
    const pdf = source({
      kind: "pdf",
      sha256: pdfSha,
      pageCount: 20,
      ranges: [
        { start: 1, end: 5 },
        { start: 4, end: 8 },
      ],
    });
    expect(chargeableAmounts([recording, again, pdf], new Map(), 1000, false)).toEqual(
      amounts({ audio: 7676, document: 8 }),
    );
  });

  it("charges unpaid PDF pages and keeps regeneration as requested", () => {
    const pdf = source({ kind: "pdf", sha256: pdfSha, pageCount: 10 });
    expect(chargeableAmounts([pdf], covered("pdf", pdfSha, false, [[1, 5]]), 1000, true)).toEqual(
      amounts({ document: 6, regeneration: 1 }),
    );
    const photo = source({ kind: "image", sha256: "d".repeat(64) });
    expect(chargeableAmounts([photo], covered("image", photo.sha256, true), 1000, true)).toEqual(
      amounts({ regeneration: 1 }),
    );
  });
});
