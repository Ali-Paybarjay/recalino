import { randomUUID } from "node:crypto";
import { formatLogLine } from "@recalino/core/plt";
import { describe, expect, it, vi } from "vitest";
import type { HandlerArgs } from "./api";
import { captureDiagnosticsHandler } from "./recording-routes";

vi.mock("server-only", () => ({}));

function call(input: unknown, lines: string[], contentLength?: number) {
  const handler = captureDiagnosticsHandler((level, event, fields) =>
    lines.push(formatLogLine(level, event, fields)),
  );
  return handler({
    input,
    ctx: { requestId: randomUUID(), route: "captureDiagnostics", userId: randomUUID() },
    request: new Request("http://localhost/api/recordings/diagnostics", {
      method: "POST",
      headers: contentLength === undefined ? {} : { "content-length": String(contentLength) },
    }),
    db: undefined as unknown as HandlerArgs["db"],
  });
}

describe("capture diagnostics route (PRD-REC-05, PRD-PRIV-06)", () => {
  it("writes one allow-listed line per event with nothing redacted or dropped", async () => {
    const lines: string[] = [];
    const result = await call(
      {
        platform: "android",
        browser: "chrome",
        events: [
          { ageMs: 1200, event: { type: "started", mime: "audio/webm;codecs=opus", part: 1 } },
          {
            ageMs: 0,
            event: {
              type: "gap",
              part: 1,
              offsetMs: 5000,
              missingMs: 1680000,
              cause: "hidden",
            },
          },
          {
            ageMs: 0,
            event: {
              type: "part",
              part: 1,
              mime: "audio/webm;codecs=opus",
              measured: true,
              mediaMs: 66000,
              wallMs: 1752000,
              missingMs: 1680000,
              gaps: 1,
            },
          },
        ],
      },
      lines,
    );
    expect(result).toEqual({ status: 202, body: { accepted: 3 } });
    const records = lines.map((line) => JSON.parse(line));
    for (const record of records) {
      expect(record.event).toBe("capture_health");
      expect(record.dropped_fields).toBeUndefined();
      expect(JSON.stringify(record)).not.toContain("[redacted]");
    }
    expect(records[0]).toMatchObject({
      capture_event: "started",
      mime: "audio/webm",
      codec: "opus",
    });
    expect(records[1]).toMatchObject({
      capture_event: "gap",
      missing_ms: 1680000,
      cause: "hidden",
    });
    expect(records[2]).toMatchObject({ media_ms: 66000, wall_ms: 1752000, measured: true });
  });

  it("refuses hostile payloads: oversized, too many events, text, identifiers, scripts", async () => {
    const visible = { ageMs: 0, event: { type: "visibility", visible: false } };
    const lines: string[] = [];
    await expect(
      call({ platform: "ios", browser: "safari", events: [visible] }, lines, 20000),
    ).rejects.toMatchObject({ code: "payload_too_large" });
    for (const body of [
      { platform: "ios", browser: "safari", events: Array(51).fill(visible) },
      { platform: "ios", browser: "safari", events: [] },
      {
        platform: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5)",
        browser: "safari",
        events: [visible],
      },
      { platform: "ios", browser: "safari", events: [visible], sessionId: randomUUID() },
      { platform: "ios", browser: "safari", events: [visible], transcript: "The teacher said" },
      {
        platform: "ios",
        browser: "safari",
        events: [
          { ageMs: 0, event: { type: "started", mime: "<script>alert(1)</script>", part: 1 } },
        ],
      },
      {
        platform: "ios",
        browser: "safari",
        events: [
          {
            ageMs: 1e12,
            event: { type: "gap", part: 1, offsetMs: -1, missingMs: 1, cause: "hidden" },
          },
        ],
      },
      "a string",
      null,
    ]) {
      await expect(call(body, lines)).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(lines).toEqual([]);
  });

  it("logs a board photo verdict as numbers and the local photo id only (D72)", async () => {
    const lines: string[] = [];
    const photoId = randomUUID();
    const quality = {
      type: "photo_quality",
      photoId,
      verdict: "blurry",
      sharpness: 20,
      exposure: 863,
      glare: 0,
      edgeDensity: 121,
    };
    // Fifty verdicts, the largest batch, still fit well inside the 16 KiB cap.
    const body = {
      platform: "android",
      browser: "chrome",
      events: Array.from({ length: 50 }, () => ({ ageMs: 600000, event: quality })),
    };
    expect(JSON.stringify(body).length).toBeLessThan(16 * 1024);
    await expect(call(body, lines)).resolves.toEqual({ status: 202, body: { accepted: 50 } });
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record).toMatchObject({
      capture_event: "photo_quality",
      photo_id: photoId,
      verdict: "blurry",
      sharpness: 20,
      exposure: 863,
      glare: 0,
      edge_density: 121,
    });
    expect(record.dropped_fields).toBeUndefined();
    for (const event of [
      { ...quality, photoId: "board.jpg" },
      { ...quality, verdict: "unreadable" },
      { ...quality, sharpness: 1001 },
      { ...quality, glare: 0.5 },
      { ...quality, pixels: [255, 255, 255] },
    ])
      await expect(
        call({ platform: "ios", browser: "safari", events: [{ ageMs: 0, event }] }, []),
      ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses free text, identifiers and unknown fields", async () => {
    for (const event of [
      { type: "visibility", visible: false, note: "teacher said hello" },
      { type: "started", mime: "text/html", part: 1 },
      { type: "gap", part: 1, offsetMs: 0, missingMs: 1, cause: "because the class was boring" },
    ]) {
      const lines: string[] = [];
      await expect(
        call({ platform: "ios", browser: "safari", events: [{ ageMs: 0, event }] }, lines),
      ).rejects.toMatchObject({ code: "validation_failed" });
      expect(lines).toEqual([]);
    }
  });
});
