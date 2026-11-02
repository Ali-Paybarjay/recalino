import {
  type CaptureDiagnostics,
  captureDiagnosticsSchema,
} from "../../shared/capture-diagnostics-contract";
import type { CaptureHealthEvent } from "./controller";

/** The contract lives in `shared/` so the server reads it without importing `ui` (RR-30). */
export {
  BROWSERS,
  type CaptureDiagnostics,
  captureDiagnosticsSchema,
  captureHealthEventSchema,
  PLATFORMS,
} from "../../shared/capture-diagnostics-contract";

/** Coarse families only; never the user agent string or a version. */
export function deviceFamily(userAgent: string): Pick<CaptureDiagnostics, "platform" | "browser"> {
  const ua = userAgent.toLowerCase();
  const platform = /android/.test(ua)
    ? "android"
    : /iphone|ipad|ipod/.test(ua)
      ? "ios"
      : /cros/.test(ua)
        ? "chromeos"
        : /windows/.test(ua)
          ? "windows"
          : /macintosh|mac os x/.test(ua)
            ? "macos"
            : /linux/.test(ua)
              ? "linux"
              : "other";
  const browser = /samsungbrowser/.test(ua)
    ? "samsung"
    : /edg\//.test(ua)
      ? "edge"
      : /firefox|fxios/.test(ua)
        ? "firefox"
        : /chrome|crios|chromium/.test(ua)
          ? "chrome"
          : /safari/.test(ua)
            ? "safari"
            : "other";
  return { platform, browser };
}

type Source = { onHealth(listener: (event: CaptureHealthEvent) => void): () => void };
type Options = {
  send: (body: CaptureDiagnostics) => Promise<unknown>;
  now?: () => number;
  userAgent: string;
  /** Batches wait at most this long while capture runs. */
  intervalMs?: number;
};

/** Collects capture health events and sends them in small batches; failures are dropped. */
export function watchCaptureDiagnostics(source: Source, options: Options) {
  const now = options.now ?? Date.now;
  const family = deviceFamily(options.userAgent);
  let queue: { at: number; event: CaptureHealthEvent }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!queue.length) return;
    const at = now();
    const batch = queue.splice(0, 50);
    const body = captureDiagnosticsSchema.safeParse({
      ...family,
      events: batch.map((item) => ({
        ageMs: Math.min(24 * 60 * 60 * 1000, Math.max(0, Math.round(at - item.at))),
        event: item.event,
      })),
    });
    if (body.success) void options.send(body.data).catch(() => {});
    if (queue.length) flush();
  };
  const unsubscribe = source.onHealth((event) => {
    if (event.type === "photo_removed") {
      queue = queue.filter(
        (item) => item.event.type !== "photo_quality" || item.event.photoId !== event.photoId,
      );
      return;
    }
    queue.push({ at: now(), event });
    if (queue.length > 200) queue = queue.slice(-200);
    // A part's summary, a gap, a hidden page, a pause or a restore are moments worth sending now:
    // the page may be lost soon after (D104).
    if (
      event.type === "part" ||
      event.type === "gap" ||
      event.type === "pause" ||
      event.type === "restored" ||
      (event.type === "visibility" && !event.visible)
    )
      flush();
    else if (timer === null) timer = setTimeout(flush, options.intervalMs ?? 60000);
  });
  return () => {
    unsubscribe();
    flush();
  };
}
