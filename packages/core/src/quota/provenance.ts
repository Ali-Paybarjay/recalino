import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";

/**
 * Identifiers only. Consumers join these owner-scoped accounting projections before
 * pagination, so an unbilled attempt cannot consume a completed-result candidate slot.
 * The consumer must bind both projections to its attempt, run and reservation IDs.
 */
export function providerAccountingProvenanceQueries(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
) {
  return {
    costs: db
      .selectFrom("quota.provider_cost")
      .select(["attempt_id", "run_id", "operation_key"])
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", sessionId),
    closedHolds: db
      .selectFrom("quota.cost_hold")
      .select(["id", "reservation_id"])
      .where("user_id", "=", ctx.userId)
      .where("session_id", "=", sessionId)
      .where("closed_at", "is not", null),
  };
}
