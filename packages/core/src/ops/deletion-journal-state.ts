import type { Database } from "../db";

/**
 * Whether the durable, encrypted record of a deletion request has been written (`ready`, or
 * already `deleted` after its retention). Reads one row by the request id; it exposes no subject
 * id. Pages use it to tell "the request is saved and being carried out" from "the receipt still
 * needs to be saved" (UX-10).
 */
export async function deletionJournalSaved(db: Database, requestId: string): Promise<boolean> {
  const row = await db
    .selectFrom("ops.deletion_journal")
    .select("state")
    .where("request_id", "=", requestId)
    .executeTakeFirst();
  return row?.state === "ready" || row?.state === "deleted";
}
