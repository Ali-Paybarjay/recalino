import { pendingClassRecordings } from "./processing-readiness";
import type { LocalPhoto, Recording } from "./store";

/**
 * Which recorded parts the recording page lists (D107). With a current recording (during capture
 * and after Stop): only that recording and the earlier recordings of its session; a capture
 * started on Today has no session until /api/classes answers, so its own capture comes first. On a
 * session's recording page: only that session. Without either (/recordings): every recording on
 * this device, as the place to recover and export them (D29).
 */
export type PartScope =
  | { kind: "recording"; sessionId: string | null; rows: Recording[] }
  | { kind: "session"; sessionId: string; rows: Recording[] }
  | { kind: "device"; sessionId: null; rows: Recording[] };

const captureOf = (row: Pick<Recording, "id" | "captureId">) => row.captureId ?? row.id;

/** Part 1 on top: the order the parts were made, then their number within a recording. */
export function partOrder(left: Recording, right: Recording) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    (left.segment ?? 1) - (right.segment ?? 1) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Filters at render time: the page keeps every row for the notice, photo upload and retake, which
 * look rows up by id across sessions.
 */
export function partScope(
  rows: readonly Recording[],
  current: Recording | null,
  sessionId?: string,
): PartScope {
  // A recording of another session is not this session page's recording.
  if (current && (sessionId === undefined || current.sessionId === sessionId)) {
    const capture = captureOf(current);
    const session = current.sessionId;
    return {
      kind: "recording",
      sessionId: session,
      rows: rows
        .filter(
          (row) => captureOf(row) === capture || (session !== null && row.sessionId === session),
        )
        .sort(partOrder),
    };
  }
  if (sessionId)
    return {
      kind: "session",
      sessionId,
      rows: rows.filter((row) => row.sessionId === sessionId).sort(partOrder),
    };
  return { kind: "device", sessionId: null, rows: [...rows].sort(partOrder) };
}

/** The device list (/recordings without a recording): one group per recording, newest first. */
export function recordingGroups(rows: readonly Recording[]) {
  const groups = new Map<string, Recording[]>();
  for (const row of [...rows].sort(partOrder)) {
    const parts = groups.get(captureOf(row)) ?? [];
    parts.push(row);
    groups.set(captureOf(row), parts);
  }
  return [...groups.entries()]
    .map(([id, parts]) => ({ id, parts }))
    .sort((left, right) => partOrder(right.parts[0] as Recording, left.parts[0] as Recording));
}

/** Finished in-app parts that the sync adds to their session (source-sync.ts `automatic`). */
function addable(row: Recording) {
  return (
    row.autoRegister === true &&
    Boolean(row.completedAt) &&
    ["saved", "interrupted"].includes(row.status) &&
    !row.awaitingFinalData &&
    row.bytes > 0
  );
}

/** "{added} parts added · {pending} remaining" for the listed parts only, not the whole device. */
export function partsSync(rows: readonly Recording[]) {
  const parts = rows.filter(addable);
  const pending = parts.filter((row) => !row.sourceAssetId).length;
  return { added: parts.length - pending, pending };
}

/**
 * Whether every part and board photo of the session on this device has reached the server, so
 * "Process this session" can include them all (D107). A recording still open, a part waiting for
 * its final audio or registration, and a photo not uploaded yet all keep it waiting.
 */
export function sessionMaterialSent(
  rows: readonly Recording[],
  photos: readonly LocalPhoto[],
  sessionId: string | null,
) {
  if (!sessionId) return false;
  // Parts of a recording whose session was attached later are part of it too.
  const unattached = rows.filter((row) => row.autoRegister === true && row.sessionId === null);
  if (unattached.some((row) => row.bytes > 0 || !row.completedAt)) return false;
  if (pendingClassRecordings(rows, sessionId).length) return false;
  const ids = new Set(rows.map((row) => row.id));
  return photos.every((photo) => !ids.has(photo.recordingId) || !!photo.sourceAssetId);
}
