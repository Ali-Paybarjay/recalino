import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureDiagnosticsSchema,
  deviceFamily,
  watchCaptureDiagnostics,
} from "./capture-diagnostics";
import type { CaptureHealthEvent } from "./controller";

function source() {
  let listener: ((event: CaptureHealthEvent) => void) | null = null;
  return {
    onHealth(next: (event: CaptureHealthEvent) => void) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    emit(event: CaptureHealthEvent) {
      listener?.(event);
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("capture diagnostics client (PRD-PRIV-06)", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36",
      "android",
      "chrome",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36",
      "android",
      "samsung",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1",
      "ios",
      "safari",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0",
      "windows",
      "edge",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:143.0) Gecko/20100101 Firefox/143.0",
      "macos",
      "firefox",
    ],
  ])("keeps only the device family of %s", (ua, platform, browser) => {
    expect(deviceFamily(ua)).toEqual({ platform, browser });
  });

  it("batches routine events and sends gaps, parts and hidden pages at once", () => {
    vi.useFakeTimers();
    const events = source();
    const send = vi.fn(async () => {});
    let now = 0;
    const stop = watchCaptureDiagnostics(events, {
      send,
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile",
      now: () => now,
    });
    events.emit({ type: "started", mime: "audio/webm;codecs=opus", part: 1 });
    events.emit({ type: "wake_lock", state: "acquired" });
    expect(send).not.toHaveBeenCalled();
    now = 30000;
    events.emit({ type: "visibility", visible: false });
    expect(send).toHaveBeenCalledTimes(1);
    const body = (send.mock.calls[0] as unknown[])[0];
    expect(captureDiagnosticsSchema.parse(body)).toEqual({
      platform: "android",
      browser: "chrome",
      events: [
        { ageMs: 30000, event: { type: "started", mime: "audio/webm;codecs=opus", part: 1 } },
        { ageMs: 30000, event: { type: "wake_lock", state: "acquired" } },
        { ageMs: 0, event: { type: "visibility", visible: false } },
      ],
    });
    events.emit({ type: "lifecycle", state: "throttled" });
    vi.advanceTimersByTime(60000);
    expect(send).toHaveBeenCalledTimes(2);
    events.emit({ type: "track", state: "muted" });
    stop();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends a board photo verdict as integer scores and the local photo id only (D72)", () => {
    vi.useFakeTimers();
    const events = source();
    const send = vi.fn(async () => {});
    watchCaptureDiagnostics(events, { send, userAgent: "", now: () => 0 });
    const photoId = crypto.randomUUID();
    const quality = {
      type: "photo_quality",
      photoId,
      verdict: "glare",
      sharpness: 433,
      exposure: 863,
      glare: 74,
      edgeDensity: 64,
    } as const;
    events.emit(quality);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    const body = captureDiagnosticsSchema.parse((send.mock.calls[0] as unknown[])[0]);
    expect(body.events).toEqual([{ ageMs: 0, event: quality }]);
  });

  it("withdraws the unsent verdict of a photo removed from this device", () => {
    vi.useFakeTimers();
    const events = source();
    const send = vi.fn(async () => {});
    watchCaptureDiagnostics(events, { send, userAgent: "", now: () => 0 });
    const scores = { sharpness: 20, exposure: 863, glare: 0, edgeDensity: 121 };
    const removed = crypto.randomUUID();
    const kept = crypto.randomUUID();
    events.emit({ type: "photo_quality", photoId: removed, verdict: "blurry", ...scores });
    events.emit({ type: "photo_quality", photoId: kept, verdict: "ok", ...scores });
    events.emit({ type: "photo_removed", photoId: removed });
    vi.advanceTimersByTime(60000);
    expect(send).toHaveBeenCalledTimes(1);
    const body = captureDiagnosticsSchema.parse((send.mock.calls[0] as unknown[])[0]);
    expect(body.events.map((item) => item.event)).toEqual([
      { type: "photo_quality", photoId: kept, verdict: "ok", ...scores },
    ]);
    events.emit({ type: "photo_removed", photoId: kept });
    vi.advanceTimersByTime(60000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops a failed send without affecting capture", async () => {
    const events = source();
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    watchCaptureDiagnostics(events, { send, userAgent: "" });
    expect(() =>
      events.emit({ type: "gap", part: 1, offsetMs: 0, missingMs: 4000, cause: "unknown" }),
    ).not.toThrow();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
