import { z } from "zod";
import { GAP_CAUSES } from "./capture-meter";
import type { CaptureHealthEvent } from "./controller";
import { PHOTO_VERDICTS } from "./photo-quality";

/**
 * Capture-health diagnostics (PRD-REC-03, PRD-REC-05) without content (PRD-PRIV-06): enums,
 * bounded integers and the recorder MIME only. No audio, text, class or recording identifiers;
 * the server log line adds only the request and user ids every request already carries. The one
 * exception is `photo_quality` (D72): the random local id of a board photo, which is also its
 * upload operation key, so the on-device verdict can be compared with the server's outcome.
 */
const ms = z
  .int()
  .min(0)
  .max(24 * 60 * 60 * 1000);
const part = z.int().min(1).max(1000);
const score = z.int().min(0).max(1000);
const mime = z
  .string()
  .regex(/^audio\/[a-z0-9.+-]+(;\s?codecs=[a-z0-9.,-]+)?$/i)
  .max(60);
export const captureHealthEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("started"), mime, part }),
  z.strictObject({ type: z.literal("visibility"), visible: z.boolean() }),
  z.strictObject({
    type: z.literal("lifecycle"),
    state: z.enum(["frozen", "resumed", "throttled"]),
  }),
  z.strictObject({
    type: z.literal("wake_lock"),
    state: z.enum(["acquired", "released", "unavailable", "failed"]),
  }),
  z.strictObject({ type: z.literal("track"), state: z.enum(["muted", "unmuted", "ended"]) }),
  z.strictObject({
    type: z.literal("gap"),
    part,
    offsetMs: ms,
    missingMs: ms,
    cause: z.enum(GAP_CAUSES),
  }),
  z.strictObject({ type: z.literal("interrupted"), part }),
  z.strictObject({
    type: z.literal("staged"),
    part,
    result: z.enum(["staged", "skipped", "failed"]),
    durationMs: ms,
  }),
  z.strictObject({
    type: z.literal("photo_quality"),
    photoId: z.uuid(),
    verdict: z.enum(PHOTO_VERDICTS),
    sharpness: score,
    exposure: score,
    glare: score,
    edgeDensity: score,
  }),
  z.strictObject({
    type: z.literal("part"),
    part,
    mime,
    measured: z.boolean(),
    mediaMs: ms,
    wallMs: ms,
    missingMs: ms,
    gaps: z.int().min(0).max(500),
  }),
]);
export const PLATFORMS = [
  "android",
  "ios",
  "windows",
  "macos",
  "linux",
  "chromeos",
  "other",
] as const;
export const BROWSERS = ["chrome", "safari", "firefox", "edge", "samsung", "other"] as const;
export const captureDiagnosticsSchema = z.strictObject({
  platform: z.enum(PLATFORMS),
  browser: z.enum(BROWSERS),
  events: z
    .array(z.strictObject({ ageMs: ms, event: captureHealthEventSchema }))
    .min(1)
    .max(50),
});
export type CaptureDiagnostics = z.infer<typeof captureDiagnosticsSchema>;

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
    // A part's summary, a gap or a hidden page are moments worth sending now.
    if (
      event.type === "part" ||
      event.type === "gap" ||
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
