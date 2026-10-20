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
  // D100: an export left out of a list because its stored snapshot is malformed (id only).
  "export_id",
  "attempt",
  "module",
  "error_name",
  "pg_code",
  // OPS-02: where a server error was thrown (relative file:line:column of the first stack frame,
  // never the message) and a provider's transport cause, e.g. "ECONNRESET" or "timeout".
  "error_location",
  "cause_code",
  // OPS-05: migration versions (digits only) of the deployed code and of the database.
  "schema_expected",
  "schema_applied",
  // Identifier-like cause of a server error, e.g. a missing configuration name; never a value.
  "reason",
  // Class voice check attrition: integer counts and durations, never audio or text.
  "windows_planned",
  "windows_used",
  "windows_refused",
  "windows_short",
  "audio_planned_ms",
  "audio_used_ms",
  // In-app capture health (PRD-REC-05): enums, coarse device family and integers only.
  "capture_event",
  "platform",
  "browser",
  "mime",
  "codec",
  "state",
  "visible",
  "part",
  "cause",
  "measured",
  "age_ms",
  "offset_ms",
  "missing_ms",
  "media_ms",
  "wall_ms",
  "gaps",
  "result",
  // On-device board photo readability (D72): the local photo id and integer scores 0–1000 only.
  "photo_id",
  "verdict",
  "sharpness",
  "exposure",
  "glare",
  "edge_density",
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

// "    at fn (path:line:column)" or "    at path:line:column".
const STACK_FRAME = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?\s*$/;
const LOCATION_UNSAFE = /[^A-Za-z0-9_.:/\-[\]]/g;

/** A frame's file, relative and without machine-specific prefixes; null for runtime internals. */
function frameFile(raw: string, root: string): string | null {
  let file = raw.replace(/^file:\/\//, "").replace(/\\/g, "/");
  if (/^(node:|native$|<anonymous>$)/.test(file)) return null;
  file = file.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?(\.\/)?/, "");
  const modules = file.lastIndexOf("node_modules/");
  if (modules >= 0) return file.slice(modules);
  const base = root.replace(/\\/g, "/").replace(/\/$/, "");
  if (base && file.startsWith(`${base}/`)) return file.slice(base.length + 1);
  const built = file.indexOf("/.next/");
  if (built >= 0) return file.slice(built + 1);
  // Any other absolute path may name a machine or a person: keep only its last three parts.
  return file.startsWith("/") ? file.split("/").slice(-3).join("/") : file;
}

/**
 * OPS-02: where an error was thrown, as "file:line:column" of its first stack frame outside the
 * runtime, relative to the app root. The lines that repeat the name and message are skipped, so
 * the message, which may hold class text, never reaches a log (PRD-PRIV-06).
 */
export function errorLocation(error: unknown, root: string = process.cwd()): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  const header = String(error.message).split("\n").length;
  for (const line of error.stack.split("\n").slice(header)) {
    const frame = STACK_FRAME.exec(line);
    if (!frame) continue;
    const file = frameFile(frame[1] ?? "", root);
    if (file === null) continue;
    const location = `${file}:${frame[2]}:${frame[3]}`.replace(LOCATION_UNSAFE, "_");
    return location.length > 128 ? location.slice(-128) : location;
  }
  return undefined;
}

/** A provider error's transport cause code (FR-AIP), when it carries an identifier-like one. */
export function causeCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("causeCode" in error)) return undefined;
  const value = (error as { causeCode: unknown }).causeCode;
  return typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : undefined;
}

const stdoutSink: LogSink = (line) => {
  console.log(line);
};

export function createLogger(sink: LogSink = stdoutSink): Logger {
  return (level, event, fields) => sink(formatLogLine(level, event, fields));
}
