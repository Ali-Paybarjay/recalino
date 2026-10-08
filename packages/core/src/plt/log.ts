/**
 * Structured logging with an allow-list (FR-PLT-007, PRD-PRIV-06). Only known fields are written,
 * and string values must look like identifiers; anything else (class text, file content, prompts,
 * secrets, signed URLs) is replaced with "[redacted]". Unknown fields are dropped and counted.
 */
const ALLOWED_FIELDS = new Set([
  "request_id",
  "user_id",
  "route",
  "method",
  "status",
  "duration_ms",
  "code",
  "kind",
  "job_id",
  "object_id",
  "attempt",
  "module",
  "error_name",
  "pg_code",
  // Class voice check attrition: integer counts and durations, never audio or text.
  "windows_planned",
  "windows_used",
  "windows_refused",
  "windows_short",
  "audio_planned_ms",
  "audio_used_ms",
]);

const IDENTIFIER = /^[A-Za-z0-9_.:/\-[\]]{1,128}$/;

export type LogLevel = "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | undefined;
export type LogSink = (line: string) => void;
export type Logger = (level: LogLevel, event: string, fields?: Record<string, LogValue>) => void;

function safeValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return IDENTIFIER.test(value) ? value : "[redacted]";
  return undefined;
}

export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  now: Date = new Date(),
): string {
  try {
    const record: Record<string, unknown> = {
      time: now.toISOString(),
      level,
      event: IDENTIFIER.test(event) ? event : "[redacted]",
    };
    let dropped = 0;
    for (const [key, value] of Object.entries(fields)) {
      const safe = ALLOWED_FIELDS.has(key) ? safeValue(value) : undefined;
      if (safe === undefined) {
        if (value !== undefined) dropped += 1;
      } else {
        record[key] = safe;
      }
    }
    if (dropped > 0) record.dropped_fields = dropped;
    return JSON.stringify(record);
  } catch {
    // If sanitising fails, write a generic line rather than anything raw.
    return JSON.stringify({ time: now.toISOString(), level: "error", event: "log_record_failed" });
  }
}

const stdoutSink: LogSink = (line) => {
  console.log(line);
};

export function createLogger(sink: LogSink = stdoutSink): Logger {
  return (level, event, fields) => sink(formatLogLine(level, event, fields));
}
