import { z } from "zod";
import type { Database } from "../db";
import { errors, recordAudit } from "../plt";
import { type createProcessingRun, retryRun } from "./runs";

/** Trusted owner command; the web gateway supplies a verified owner identity. */
export async function retryRunAsAdmin(
  db: Database,
  input: {
    runId: string;
    actorId: string;
    operationKey: string;
    reason: string;
    requestId: string;
  },
  options: Parameters<typeof createProcessingRun>[3],
) {
  z.uuid().parse(input.runId);
  z.uuid().parse(input.actorId);
  z.string().min(8).max(128).parse(input.operationKey);
  z.string().trim().min(1).max(500).parse(input.reason);
  const row = await db
    .selectFrom("proc.processing_run")
    .select(["id", "user_id", "state"])
    .where("id", "=", input.runId)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  const unresolved = await db
    .selectFrom("proc.provider_attempt")
    .select("id")
    .where("run_id", "=", row.id)
    .where("state", "in", ["started", "uncertain"])
    .executeTakeFirst();
  if (unresolved || row.state !== "failed") throw errors.conflict();
  const run = await retryRun(
    db,
    { userId: row.user_id, requestId: input.requestId },
    row.id,
    input.operationKey,
    options,
  );
  await recordAudit(db, {
    actorKind: "operator",
    actorId: input.actorId,
    action: "processing.retry",
    subjectType: "processing_run",
    subjectId: row.id,
    reason: input.reason,
    requestId: input.operationKey,
  });
  return run;
}
