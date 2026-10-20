/**
 * Where an unfinished account deletion stands, as the recovery page tells it (UX-10).
 *
 * - `journal_unsaved`: the account is hidden but the durable receipt is not saved, so the learner
 *   confirms it ("Finish deletion"). Nothing else can tell the server the request was received.
 * - `in_progress`: the receipt is saved and cleanup is queued or running; there is nothing to
 *   confirm. The cleanup ends the browser session by itself.
 * - `needs_operator`: cleanup stopped and only the operator can finish it.
 */
export type DeletionStage = "journal_unsaved" | "in_progress" | "needs_operator";

export function deletionStage(
  receiptState: "pending" | "needs_operator" | "completed",
  journalSaved: boolean,
): DeletionStage {
  if (receiptState === "needs_operator") return "needs_operator";
  return journalSaved ? "in_progress" : "journal_unsaved";
}
