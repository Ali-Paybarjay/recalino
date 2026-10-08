import type { Recording } from "./store";

/** Do not silently process only the first part of a continuing/local capture. */
export function pendingClassRecordings(rows: readonly Recording[], sessionId: string) {
  return rows.filter(
    (row) =>
      row.autoRegister === true &&
      row.sessionId === sessionId &&
      (!row.completedAt || (row.bytes > 0 && (row.awaitingFinalData || !row.sourceAssetId))),
  );
}
