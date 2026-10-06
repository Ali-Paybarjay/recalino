import type { Database, Tx } from "../db";

/** Identifiers only; reconciliation can exclude deleted owners before its own limit. */
export function liveAccountIdsQuery(db: Database | Tx) {
  return db.selectFrom("acc.user_account").select("id").where("deleted_at", "is", null);
}
