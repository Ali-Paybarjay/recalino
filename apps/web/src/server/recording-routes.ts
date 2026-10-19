import "server-only";
import { createLogger, errors, type Logger } from "@recalino/core/plt";
import { createRecordedSource } from "@recalino/core/src";
import { captureDiagnosticsSchema } from "../ui/recording/capture-diagnostics";
import { type Handler, idempotencyKey, learnerActor } from "./api";
export function recordingSourceHandler(): Handler {
  return async ({ db, ctx, input, request }) => {
    const learner = learnerActor(ctx);
    const operationKey = idempotencyKey(request);
    const result = await createRecordedSource(db, learner, {
      ...(input as Record<string, unknown>),
      operationKey,
    });
    return { status: 201, body: result };
  };
}
/**
 * One allow-listed `capture_health` log line per event (PRD-REC-05). Nothing is stored; the lines
 * carry no audio, text or class/recording ids (PRD-PRIV-06). `RECALINO_CAPTURE_DIAGNOSTICS=off`
 * accepts and drops the events (202 either way).
 */
/** Fifty small events never need more than this; anything larger is not a diagnostics batch. */
export const CAPTURE_DIAGNOSTICS_MAX_BYTES = 16 * 1024;
export function captureDiagnosticsHandler(log: Logger = createLogger()): Handler {
  return async ({ ctx, input, request }) => {
    if (!ctx.userId) throw errors.unauthenticated();
    if (Number(request.headers.get("content-length") ?? 0) > CAPTURE_DIAGNOSTICS_MAX_BYTES)
      throw errors.payloadTooLarge();
    const parsed = captureDiagnosticsSchema.safeParse(input);
    if (!parsed.success) throw errors.validationFailed({ events: ["invalid"] });
    if (process.env.RECALINO_CAPTURE_DIAGNOSTICS === "off")
      return { status: 202, body: { accepted: parsed.data.events.length } };
    const { platform, browser, events } = parsed.data;
    for (const { ageMs, event } of events) {
      const { type, ...fields } = event;
      const mime = "mime" in fields ? fields.mime : undefined;
      const record: Record<string, string | number | boolean | undefined> = {
        request_id: ctx.requestId,
        user_id: ctx.userId,
        capture_event: type,
        platform,
        browser,
        age_ms: ageMs,
        mime: mime?.split(";")[0],
        codec: mime?.match(/codecs=([a-z0-9.-]+)/i)?.[1],
      };
      for (const [key, value] of Object.entries(fields)) {
        if (key === "mime") continue;
        record[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
      }
      log("info", "capture_health", record);
    }
    return { status: 202, body: { accepted: parsed.data.events.length } };
  };
}
