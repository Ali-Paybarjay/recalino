import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PartsSyncStatus, partTitle, RecordedParts } from "./RecordedParts";
import type { Recording } from "./store";

const row = (patch: Partial<Recording> = {}): Recording => ({
  id: "30000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
  sessionId: null,
  captureId: "30000000-0000-4000-8000-000000000001",
  creationKey: "40000000-0000-4000-8000-000000000001",
  sourceAssetId: null,
  autoRegister: true,
  mimeType: "audio/webm",
  status: "saved",
  activeMs: 599_000,
  chunks: 1,
  bytes: 5,
  completedAt: "2026-10-20T10:00:00.000Z",
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  ...patch,
});
const actions = { listen: vi.fn(), exportAudio: vi.fn(), remove: vi.fn() };

// D107 (owner decision 2026-10-20): "Part {n} · {duration}", Part 1 included.
describe("a recorded part's line", () => {
  it("numbers every part, the first one too", () => {
    expect(partTitle(row(), 599_000)).toBe("Part 1 · 9:59");
    expect(partTitle(row({ segment: 12 }), 61_000)).toBe("Part 12 · 1:01");
  });

  it("adds the minutes not recorded after Stop only", () => {
    const gaps = [
      {
        from: "2026-10-20T09:05:00.000Z",
        to: "2026-10-20T09:07:00.000Z",
        offsetMs: 300_000,
        missingMs: 120_000,
        cause: "stalled" as const,
      },
    ];
    const saved = renderToStaticMarkup(
      createElement(RecordedParts, { rows: [row({ gaps })], phase: "saved", actions }),
    );
    expect(saved).toContain("Part 1 · 9:59 · 2 min not recorded");
    const live = renderToStaticMarkup(
      createElement(RecordedParts, {
        rows: [row({ gaps })],
        phase: "recording",
        live: { id: row().id, ms: 1000, recovering: false },
      }),
    );
    expect(live).toContain("Part 1 · 0:01");
    expect(live).not.toContain("not recorded");
    expect(live).toContain("Recording in progress");
    // An earlier, sealed part of the same capture waits for Stop too (PRD-REC-02).
    const second = "30000000-0000-4000-8000-000000000002";
    const during = renderToStaticMarkup(
      createElement(RecordedParts, {
        rows: [row({ gaps }), row({ id: second, segment: 2, status: "recording" })],
        phase: "recording",
        live: { id: second, ms: 1000, recovering: false },
      }),
    );
    expect(during).toContain("Part 1 · 9:59");
    expect(during).not.toContain("not recorded");
  });

  it("plays a part only after Stop, so its sound is never recorded", () => {
    const player = { id: row().id, url: "blob:part-1" };
    const after = renderToStaticMarkup(
      createElement(RecordedParts, { rows: [row()], phase: "saved", actions, player }),
    );
    expect(after).toContain("<audio");
    const during = renderToStaticMarkup(
      createElement(RecordedParts, { rows: [row()], phase: "recording", player }),
    );
    expect(during).not.toContain("<audio");
  });

  it("asks before removing a part, with the acknowledgement only for audio not sent", () => {
    const unsent = renderToStaticMarkup(
      createElement(RecordedParts, { rows: [row()], phase: "saved", actions }),
    );
    expect(unsent).toContain("This removes the local audio and board photos.");
    expect(unsent).toContain(">Confirm local removal<");
    expect(unsent).toContain(">Keep<");
    expect(unsent).toContain('type="checkbox"');
    const sent = renderToStaticMarkup(
      createElement(RecordedParts, {
        rows: [row({ sourceAssetId: "a" })],
        phase: "saved",
        actions,
      }),
    );
    expect(sent).not.toContain('type="checkbox"');
  });

  it("opens the player under its own line only", () => {
    const html = renderToStaticMarkup(
      createElement(RecordedParts, {
        rows: [row(), row({ id: "30000000-0000-4000-8000-000000000002", segment: 2 })],
        phase: "saved",
        actions,
        player: { id: "30000000-0000-4000-8000-000000000002", url: "blob:part-2" },
      }),
    );
    expect(html.match(/<audio/g)).toHaveLength(1);
    expect(html.indexOf("blob:part-2")).toBeGreaterThan(html.indexOf("Part 2 ·"));
  });
});

describe("the sync status of the listed parts", () => {
  it("counts the listed parts while they are added", () => {
    const html = renderToStaticMarkup(
      createElement(PartsSyncStatus, { added: 1, pending: 2, phase: "syncing", error: null }),
    );
    expect(html).toContain("1 parts added · 2 remaining");
    expect(html).toContain('role="status"');
  });

  it("shows the failure with its retry, and nothing once every part is added", () => {
    const failed = renderToStaticMarkup(
      createElement(PartsSyncStatus, {
        added: 0,
        pending: 1,
        phase: "failed",
        error: "Session material could not be updated.",
      }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry adding session material");
    expect(
      renderToStaticMarkup(
        createElement(PartsSyncStatus, { added: 2, pending: 0, phase: "idle", error: null }),
      ),
    ).toBe("");
  });
});
