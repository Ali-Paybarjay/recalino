// PERF-06: the browser bundles zod/mini, which has the same parsing without the method chain.
import { z } from "zod/mini";

/**
 * The capture-diagnostics request contract, shared by the browser (`ui/recording`) and the server
 * (`server/recording-routes`) so the server does not import values from `ui` (RR-30, R-29).
 */

/** What the page observed while audio was missing; a gap may have several, the first wins. */
export const GAP_CAUSES = [
  "ended",
  "muted",
  "frozen",
  "hidden",
  "stalled",
  "interrupted",
  "unknown",
] as const;
export type GapCause = (typeof GAP_CAUSES)[number];

/** On-device readability verdicts of a board photo (D72 layers 1 and 2). */
export const PHOTO_VERDICTS = [
  "ok",
  "blurry",
  "too_dark",
  "too_bright",
  "glare",
  "low_detail",
] as const;
export type PhotoVerdict = (typeof PHOTO_VERDICTS)[number];

/**
 * Capture-health diagnostics (PRD-REC-03, PRD-REC-05) without content (PRD-PRIV-06): enums,
 * bounded integers and the recorder MIME only. No audio, text, class or recording identifiers;
 * the server log line adds only the request and user ids every request already carries. The one
 * exception is `photo_quality` (D72): the random local id of a board photo, which is also its
 * upload operation key, so the on-device verdict can be compared with the server's outcome.
 */
const ms = z.int().check(z.minimum(0), z.maximum(24 * 60 * 60 * 1000));
const part = z.int().check(z.minimum(1), z.maximum(1000));
const score = z.int().check(z.minimum(0), z.maximum(1000));
const mime = z
  .string()
  .check(z.regex(/^audio\/[a-z0-9.+-]+(;\s?codecs=[a-z0-9.,-]+)?$/i), z.maxLength(60));
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
  z.strictObject({ type: z.literal("pause"), part }),
  z.strictObject({ type: z.literal("resume"), part, reconnect: z.boolean() }),
  z.strictObject({
    type: z.literal("restored"),
    parts: part,
    state: z.enum(["recording", "paused", "sealed"]),
    awayMs: ms,
  }),
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
    gaps: z.int().check(z.minimum(0), z.maximum(500)),
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
    .check(z.minLength(1), z.maxLength(50)),
});
export type CaptureDiagnostics = z.infer<typeof captureDiagnosticsSchema>;
