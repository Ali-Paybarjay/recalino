import type { RunSnapshot } from "@recalino/core/proc";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingEstimate } from "./ProcessingView";
import {
  ProcessSession,
  ProcessSessionSummary,
  processAllowanceCovers,
  processAllowanceLines,
  processSummaryRows,
} from "./ProcessSession";

vi.mock("./AutomaticLearningProvider", () => ({
  useAutomaticLearning: () => ({ acceptStatus: vi.fn() }),
}));

type Source = RunSnapshot["sources"][number];
let next = 0;
function source(patch: Partial<Source>): Source {
  next += 1;
  return {
    sourceId: `50000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    kind: "audio",
    sha256: "a".repeat(64),
    mimeType: "audio/webm",
    durationMs: null,
    pageCount: null,
    objectId: null,
    contentVersionId: null,
    captureAnchor: null,
    ranges: [],
    units: [],
    blocks: [],
    ...patch,
  } as Source;
}
const amounts = (patch: Partial<Record<string, number>> = {}) => ({
  audio: 0,
  document: 0,
  regeneration: 0,
  tts: 0,
  storage: 0,
  ...patch,
});
function estimate(patch: Partial<ProcessingEstimate> = {}): ProcessingEstimate {
  return {
    snapshot: {
      sourcesVersion: 3,
      fingerprint: "f".repeat(64),
      sources: [
        source({ durationMs: 600_000 }),
        source({ durationMs: 600_000 }),
        source({ durationMs: 192_000 }),
        source({ kind: "image", mimeType: "image/jpeg", role: "board_photo" }),
        source({ kind: "image", mimeType: "image/jpeg", role: "board_photo" }),
        source({ kind: "pdf", mimeType: "application/pdf", pageCount: 4 }),
      ],
    },
    requested: amounts({ audio: 1392, document: 4 }),
    allowance: { remaining: amounts({ audio: 15_600, document: 96, regeneration: 3 }) },
    providerConfigured: true,
    models: null,
    ...patch,
  } as ProcessingEstimate;
}

// D107 (owner decision 2026-10-20): a summary and allowance sheet before every Process (frame C5).
describe("the Process this session summary", () => {
  it("lists the session audio with its parts, then files and photos", () => {
    expect(processSummaryRows(estimate()).map((row) => [row.label, row.value])).toEqual([
      ["Class audio", "23 min 12 sec · 3 parts"],
      ["PDF", "4 pages"],
      ["Board photos", "2 photos"],
    ]);
    const one = estimate({
      snapshot: {
        sourcesVersion: 1,
        fingerprint: "f".repeat(64),
        sources: [source({ durationMs: 60_000, ranges: [{ start: 0, end: 30_000 }] })],
      },
    });
    expect(processSummaryRows(one).map((row) => row.value)).toEqual(["0 min 30 sec"]);
  });

  it("puts what publishing uses next to what is left, in the allowance's own words", () => {
    expect(processAllowanceLines(estimate())).toEqual([
      "Class audio: 23 min 12 sec needed, 260 min 0 sec left",
      "Pages and images: 4 needed, 96 left",
    ]);
    expect(processAllowanceCovers(estimate())).toBe(true);
    expect(
      processAllowanceCovers(estimate({ allowance: { remaining: amounts({ audio: 60 }) } })),
    ).toBe(false);
    expect(processAllowanceLines(estimate({ requested: null }))).toEqual([]);
  });

  it("names the New versions unit when existing notes get a new version", () => {
    const html = renderToStaticMarkup(
      createElement(ProcessSessionSummary, {
        estimate: estimate({ requested: amounts({ audio: 600, regeneration: 1 }) }),
      }),
    );
    expect(html).toContain("New versions: 1 needed, 3 left");
    expect(html).toContain("A new version of existing notes also uses 1 New versions unit.");
  });

  it("says why it cannot start when the allowance or the service is missing", () => {
    const short = renderToStaticMarkup(
      createElement(ProcessSessionSummary, {
        estimate: estimate({ allowance: { remaining: amounts() } }),
      }),
    );
    expect(short).toContain("More allowance is needed. Recording and review remain available.");
    const service = renderToStaticMarkup(
      createElement(ProcessSessionSummary, {
        estimate: estimate({ providerConfigured: false }),
      }),
    );
    expect(service).toContain("AI is awaiting operator configuration.");
  });
});

describe("the Process this session button", () => {
  it("is a button that opens the sheet; nothing is asked of the server before it is pressed", () => {
    const html = renderToStaticMarkup(
      createElement(ProcessSession, { sessionId: "20000000-0000-4000-8000-000000000001" }),
    );
    expect(html).toMatch(/<button[^>]*class="btn btn-primary rc-btn-lg"[^>]*>Process this session/);
    // The sheet is closed: its title and promise wait in the closed dialog.
    expect(html).toContain("Process this session?");
    expect(html).toContain("Nothing is processed or charged until you confirm.");
    expect(html).toContain(">Confirm and process<");
    expect(html).toContain(">Not now<");
    expect(html).not.toMatch(/<dialog[^>]* open/);
  });

  it("can be secondary (Today, D32) and waits while material is on its way", () => {
    const html = renderToStaticMarkup(
      createElement(ProcessSession, {
        sessionId: "20000000-0000-4000-8000-000000000001",
        secondary: true,
        disabled: true,
      }),
    );
    expect(html).toMatch(/<button[^>]*class="btn btn-secondary rc-btn-lg"[^>]*disabled=""/);
  });
});
