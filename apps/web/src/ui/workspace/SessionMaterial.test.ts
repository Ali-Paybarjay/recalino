import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { InputContract } from "@recalino/core/src";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceItem } from "./SessionMaterialItems";
import { SourcesView } from "./SourcesView";
import { addMaterialLabel, sessionMaterialCopy } from "./session-material-copy";
import type { SourceRow } from "./source-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./AutomaticLearningProvider", () => ({
  useAutomaticLearning: () => ({ status: null, problem: null, refresh: vi.fn() }),
}));
vi.mock("./UploadProvider", () => ({ useUploads: () => ({ manager: {}, batches: [] }) }));

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";

function source(assetId: string, displayName: string, change: Partial<SourceRow> = {}): SourceRow {
  return {
    assetId,
    displayName,
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_200_000,
    durationMs: null,
    pageCount: 4,
    verifiedAt: "2026-10-20T09:00:00Z",
    originalDeletedAt: null,
    selected: true,
    role: "class_material",
    ranges: [],
    timeStatus: "estimated",
    contentVersionId: "20000000-0000-4000-8000-000000000001",
    uploadId: null,
    uploadState: "verified",
    rejectionReason: null,
    anchorSourceId: null,
    captureOffsetMs: null,
    captureState: null,
    ...change,
  };
}
const part = (n: number) =>
  source(`audio-${n}`, `Session recording 2026-10-20 · Part ${n}`, {
    kind: "audio",
    mimeType: "audio/webm",
    durationMs: 600_000,
    pageCount: null,
    role: "class_audio",
  });
const photo = source("photo-1", "Board photo 1.jpg", {
  kind: "image",
  mimeType: "image/jpeg",
  pageCount: null,
  role: "board_photo",
  anchorSourceId: "audio-1",
  captureOffsetMs: 24_000,
});

function item(row: SourceRow, change: Partial<Parameters<typeof SourceItem>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(SourceItem, {
      source: row,
      busy: false,
      change: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      read: vi.fn(async () => {}),
      unlock: vi.fn(async () => {}),
      localAvailable: false,
      deleteSource: vi.fn(async () => true),
      selectionDirty: vi.fn(),
      ...change,
    }),
  );
}

function view(sources: SourceRow[]) {
  return renderToStaticMarkup(
    createElement(SourcesView, {
      sessionId,
      userId,
      sources,
      contract: {} as InputContract,
      noticeAccepted: true,
      storageConfigured: true,
    }),
  );
}

/** The value of `attribute` on the first element that matches `pattern`. */
function attribute(html: string, pattern: RegExp, name: string): string | undefined {
  const tag = pattern.exec(html)?.[0] ?? "";
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
}

// D106: one compact line per file, its picture or icon first, its controls at the end.
describe("a session material line", () => {
  it("shows a photo's picture in a tile that opens the original", () => {
    const html = item(photo, { picture: "blob:local-photo" });
    const open = attribute(
      html,
      /<button[^>]*aria-label="Open original"[^>]*>/,
      "aria-describedby",
    );
    const name = attribute(html, /<strong[^>]*>Board photo 1\.jpg/, "id");
    expect(name).toBeTruthy();
    expect(open).toBe(name);
    expect(html).toMatch(
      /<button[^>]*aria-label="Open original"[^>]*><span[^>]*><img src="blob:local-photo" alt="Board photo 1.jpg" dir="auto" referrerPolicy="no-referrer"/,
    );
  });

  it("keeps the icon for audio, PDF and text, and for a photo still loading", () => {
    for (const row of [
      part(1),
      source("pdf-1", "worksheet.pdf"),
      source("text-1", "words.txt", { kind: "text" }),
    ])
      expect(item(row, { localAvailable: true })).not.toContain("<img");
    expect(item(photo)).not.toContain("<img");
  });

  it("opens the original only when it can be opened", () => {
    expect(item(part(1), { localAvailable: false })).not.toContain('aria-label="Open original"');
    expect(item(part(1), { localAvailable: true })).toContain('aria-label="Open original"');
    expect(
      item(source("gone", "gone.pdf", { originalDeletedAt: "2026-10-20T10:00:00Z" })),
    ).not.toContain('aria-label="Open original"');
  });

  it("names its small controls and ties each to the file name", () => {
    const html = item(part(2), { removeLabel: "Skip this file" });
    const name = attribute(html, /<strong[^>]*>Session recording/, "id");
    for (const label of ["Skip this file", "Delete options"]) {
      const button = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(button).toContain(`aria-describedby="${name}"`);
      expect(button).toContain("btn-icon");
      expect(button).not.toContain("rc-btn-lg");
    }
    expect(item(part(2))).toContain('aria-label="Remove from session"');
    expect(html).toContain("Session recording 2026-10-20 · Part 2");
    expect(html).toContain("Class audio · 1.2 MB");
  });

  it("ties the controls under the line to the file name too", () => {
    const tied = (html: string, pattern: RegExp) => {
      const name = attribute(html, /<strong[^>]*id="[^"]*"[^>]*>/, "id");
      expect(name).toBeTruthy();
      expect(attribute(html, pattern, "aria-describedby")?.split(" ")).toContain(name);
    };
    const pdf = item(source("pdf-1", "worksheet.pdf"));
    tied(pdf, /<summary[^>]*>/);
    tied(pdf, /<button[^>]*type="submit"[^>]*>/);
    expect(pdf).toMatch(/<button[^>]*aria-describedby="[^"]*"[^>]*>Save selection/);
    tied(item(photo), /<button[^>]*>Confirm this photo time/);
    const locked = item(
      source("locked-1", "worksheet.pdf", {
        verifiedAt: null,
        uploadState: "rejected",
        rejectionReason: "needs_password",
      }),
    );
    tied(locked, /<input[^>]*type="password"[^>]*>/);
    tied(locked, /<button[^>]*>Unlock PDF/);
  });

  it("keeps the delete options in a sheet, disabled until the tick", () => {
    const html = item(source("pdf-1", "worksheet.pdf"));
    expect(html).not.toContain("<summary>Delete options</summary>");
    expect(html).toMatch(/<dialog[^>]*>[\s\S]*<h2[^>]*>Delete options<\/h2>/);
    expect(html).toContain("I understand that deletion cannot be undone.");
    for (const label of ["Delete original file", "Delete from all sessions"])
      expect(html).toMatch(
        new RegExp(`<button[^>]*class="[^"]*rc-btn-danger[^"]*"[^>]*disabled=""[^>]*>${label}`),
      );
  });

  it("puts the range to use in a disclosure, only for audio and PDF", () => {
    const disclosure = /<summary[^>]*>Use for processing<\/summary>/;
    expect(item(source("pdf-1", "worksheet.pdf"))).toMatch(disclosure);
    expect(item(part(1))).toMatch(disclosure);
    expect(item(photo)).not.toContain("Use for processing");
  });

  it("asks to confirm a photo time only while it is estimated", () => {
    expect(item(photo)).toContain("Confirm this photo time");
    expect(item(photo)).toContain("Taken around 24.0 seconds into the recording · Estimated time");
    expect(item({ ...photo, timeStatus: "user_confirmed" })).not.toContain("Taken around");
  });

  it("lets a long name wrap, so the part number is never cut", () => {
    const css = readFileSync(resolve(import.meta.dirname, "SessionMaterial.module.css"), "utf8");
    expect(css).toMatch(/\.name\s*{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/text-overflow|line-clamp|nowrap/);
  });
});

describe("the session material list", () => {
  it("lists recorded parts in order, then photos, then documents", () => {
    const html = view([source("pdf-1", "worksheet.pdf"), photo, part(1), part(2), part(3)]);
    const order = ["Part 1", "Part 2", "Part 3", "Board photo 1.jpg", "worksheet.pdf"].map((name) =>
      html.indexOf(`${name}</strong>`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("ends a list with Add more material, next to Use existing material", () => {
    const html = view([part(1)]);
    const list = html.indexOf("</ul>");
    const add = html.indexOf(`${sessionMaterialCopy.addMore}</button>`);
    expect(list).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(list);
    expect(html.indexOf("Use existing material</button>")).toBeGreaterThan(add);
    expect(html.indexOf("Record a session")).toBeLessThan(list);
    expect(html).not.toContain("Add More Files");
  });

  it("keeps the approved texts of an empty list", () => {
    const html = view([]);
    expect(html).toContain("Add your first material");
    expect(html).toContain("Bring together your recording, handouts, photos and notes.");
    expect(html).toContain("Add Files</button>");
    expect(html).not.toContain(sessionMaterialCopy.addMore);
  });

  it("offers Add more material whenever the list shows a line, saved or on its way", () => {
    expect(addMaterialLabel({ saved: 0, pending: 0, selected: 0 })).toBe("Add Files");
    for (const counts of [
      { saved: 1, pending: 0, selected: 0 },
      { saved: 0, pending: 1, selected: 0 },
      { saved: 0, pending: 0, selected: 1 },
    ])
      expect(addMaterialLabel(counts)).toBe(sessionMaterialCopy.addMore);
  });
});
