import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { getVersion, type KnowledgeVersion } from "../lkm";
import { assertSessionOwner } from "../org";
import {
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";
import { resetSourceExtractionSelection } from "../src";
import { type RunSnapshot, sourceSnapshotSchema } from "./contracts";
import { ownedRun } from "./runs";

/** Read the exact extraction used by a knowledge version, including durable worker checkpoints. */
export async function readKnowledgeSourceSnapshot(
  db: Database | Tx,
  ctx: LearnerContext,
  knowledgeVersionId: string,
): Promise<{ knowledge: KnowledgeVersion; sources: RunSnapshot["sources"] }> {
  const knowledge = await getVersion(db, ctx, z.uuid().parse(knowledgeVersionId));
  const run = await ownedRun(db, ctx, knowledge.runId);
  if (run.session_id !== knowledge.sessionId) throw errors.conflict();
  const snapshot = sourceSnapshotSchema.parse(run.input_snapshot);
  const checkpoints = await db
    .selectFrom("proc.run_step")
    .select(["step", "output"])
    .where("run_id", "=", run.id)
    .where("step", "like", "source:%")
    .execute();
  const completed = new Map(checkpoints.map((row) => [row.step, row.output]));
  const sources = snapshot.sources.map((source) => {
    const output = completed.get(`source:${source.sourceId}`);
    if (output === undefined) return source;
    const extracted = sourceSnapshotSchema.shape.sources.element.parse(output);
    if (extracted.sourceId !== source.sourceId || extracted.kind !== source.kind)
      throw errors.conflict();
    return extracted;
  });
  return { knowledge, sources };
}

export const sourceExtractionRetrySchema = z.strictObject({
  sourceId: z.uuid(),
  contentVersionId: z.uuid(),
  knowledgeVersionId: z.uuid(),
  expectedSourcesVersion: z.number().int().nonnegative(),
});
export type SourceExtractionRetryInput = z.infer<typeof sourceExtractionRetrySchema>;
export interface SourceExtractionRetryResult {
  sourceId: string;
  sourcesVersion: number;
}

/**
 * Prepare one failed source for a fresh extraction. This creates no processing run and reserves
 * no allowance: the learner reviews the existing estimate and confirms the next attempt.
 * Persisted content, generated versions and notebook edits remain available.
 */
export async function prepareSourceExtractionRetry(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  raw: SourceExtractionRetryInput,
  options: { key: string; now?: Date },
): Promise<SourceExtractionRetryResult> {
  z.uuid().parse(sessionId);
  const input = sourceExtractionRetrySchema.parse(raw);
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const now = options.now ?? new Date();
  const result = await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: options.key,
      route: "proc.prepare_source_extraction_retry",
      requestHash: sha256Hex(canonicalJson({ sessionId, ...input })),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: async (tx) => {
        await lockAccount(tx, ctx.userId);
        // Replays still respect account/session deletion and ownership.
        await assertSessionOwner(tx, ctx, sessionId);
      },
    },
    async (tx) => {
      const { knowledge, sources } = await readKnowledgeSourceSnapshot(
        tx,
        ctx,
        input.knowledgeVersionId,
      );
      if (knowledge.sessionId !== sessionId) throw errors.notFound();
      const source = sources.find((value) => value.sourceId === input.sourceId);
      if (
        !source ||
        source.contentVersionId !== input.contentVersionId ||
        !knowledge.model.coverage.missingSourceIds.includes(input.sourceId)
      )
        throw errors.validationFailed({ source: ["retry_issue_changed"] });
      const units = source.units.filter((unit) =>
        source.ranges.length
          ? source.ranges.some((range) =>
              unit.kind === "page"
                ? unit.start >= range.start && unit.start <= range.end
                : unit.kind === "time"
                  ? unit.start >= range.start && (unit.end ?? unit.start) <= range.end
                  : true,
            )
          : true,
      );
      const selectedBlocks = source.blocks.filter((block) =>
        units.some((unit) => unit.id === block.unitId),
      );
      if (selectedBlocks.length && !units.some((unit) => unit.status !== "extracted"))
        throw errors.validationFailed({ source: ["retry_not_needed"] });
      const active = await tx
        .selectFrom("proc.processing_run")
        .select("id")
        .where("session_id", "=", sessionId)
        .where("user_id", "=", ctx.userId)
        .where("state", "in", ["awaiting_upload", "queued", "processing"])
        .executeTakeFirst();
      if (active) throw errors.conflict();
      const unresolved = await tx
        .selectFrom("proc.provider_attempt")
        .innerJoin("proc.processing_run", "proc.processing_run.id", "proc.provider_attempt.run_id")
        .select("proc.provider_attempt.id")
        .where("proc.processing_run.session_id", "=", sessionId)
        .where("proc.provider_attempt.user_id", "=", ctx.userId)
        .where("proc.processing_run.kind", "=", "class")
        .where("proc.provider_attempt.state", "in", ["started", "uncertain"])
        .executeTakeFirst();
      if (unresolved) throw errors.validationFailed({ retry: ["provider_outcome_unresolved"] });
      const sourcesVersion = await resetSourceExtractionSelection(
        tx,
        ctx,
        sessionId,
        input.sourceId,
        {
          contentVersionId: input.contentVersionId,
          sourcesVersion: input.expectedSourcesVersion,
          ranges: source.ranges,
        },
        now,
      );
      return { status: 200, body: { sourceId: input.sourceId, sourcesVersion } };
    },
  );
  return result.body as SourceExtractionRetryResult;
}
