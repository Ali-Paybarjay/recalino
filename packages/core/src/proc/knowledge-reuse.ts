import type { z } from "zod";
import type { AiProvider } from "../aip";
import type { Tx } from "../db";
import { getCourse, getSession } from "../org";
import { canonicalJson, type LearnerContext, sha256Hex } from "../plt";
import { providerAccountingProvenanceQueries } from "../quota";
import { type RunSnapshot, runSettingsSchema, sourceSnapshotSchema } from "./contracts";
import { generatedKnowledgeSchema } from "./generated-knowledge";
import { knowledgeInputContextSchema } from "./knowledge-input-context";

/**
 * Called inside createProcessingRun's owner/account lock. Only a completed, billed
 * provider response is eligible; later semantic failures remain for the worker to validate.
 */
export async function reuseCompletedKnowledge(
  tx: Tx,
  ctx: LearnerContext,
  input: {
    runId: string;
    sessionId: string;
    snapshot: RunSnapshot;
    settings: z.infer<typeof runSettingsSchema>;
    provider: AiProvider;
    now: Date;
  },
): Promise<void> {
  const session = await getSession(tx, ctx, input.sessionId);
  const course = await getCourse(tx, ctx, session.courseId);
  const currentContext = knowledgeInputContextSchema.parse({
    version: 1,
    date: session.classDate,
    ...(course.isDefault ? {} : { course: course.name }),
  });
  const accounting = providerAccountingProvenanceQueries(tx, ctx, input.sessionId);
  const candidates = await tx
    .selectFrom("proc.processing_run as run")
    .innerJoin("proc.run_step as checkpoint", "checkpoint.run_id", "run.id")
    .innerJoin("proc.provider_attempt as attempt", "attempt.run_id", "run.id")
    .innerJoin("proc.run_step as paid_checkpoint", (join) =>
      join
        .onRef("paid_checkpoint.run_id", "=", "run.id")
        .onRef("paid_checkpoint.step", "=", "attempt.step"),
    )
    .innerJoin(accounting.costs.as("cost"), "cost.attempt_id", "attempt.id")
    .innerJoin(accounting.closedHolds.as("hold"), "hold.id", "attempt.hold_id")
    .select([
      "run.id as run_id",
      "run.input_snapshot",
      "run.settings",
      "checkpoint.output",
      "attempt.id as attempt_id",
      "attempt.step as paid_step",
      "paid_checkpoint.output as paid_output",
    ])
    .where("run.user_id", "=", ctx.userId)
    .where("run.session_id", "=", input.sessionId)
    .where("run.kind", "=", "class")
    .where("run.state", "in", ["failed", "needs_input"])
    .where("run.id", "!=", input.runId)
    .where("run.sources_version", "=", input.snapshot.sourcesVersion)
    .where("run.source_fingerprint", "=", input.snapshot.fingerprint)
    .where("checkpoint.step", "=", "knowledge")
    .where("attempt.step", "in", ["knowledge", "knowledge:compact"])
    .where("attempt.user_id", "=", ctx.userId)
    .where("attempt.state", "=", "succeeded")
    .where("attempt.provider", "=", input.provider.name)
    .where("attempt.model", "=", input.settings.provider.llmModel)
    .where("attempt.finished_at", "is not", null)
    .whereRef("cost.run_id", "=", "run.id")
    .whereRef("cost.operation_key", "=", "attempt.operation_key")
    .whereRef("hold.reservation_id", "=", "run.reservation_id")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("proc.provider_attempt as unresolved")
            .select("unresolved.id")
            .whereRef("unresolved.run_id", "=", "run.id")
            .where("unresolved.state", "in", ["started", "uncertain"]),
        ),
      ),
    )
    .orderBy("run.created_at", "desc")
    .limit(50)
    .execute();
  const sameInput = canonicalJson(input.snapshot);
  const sameSettings = canonicalJson(input.settings);
  for (const candidate of candidates) {
    const snapshot = sourceSnapshotSchema.safeParse(candidate.input_snapshot);
    const settings = runSettingsSchema.safeParse(candidate.settings);
    const knowledge = generatedKnowledgeSchema.safeParse(candidate.output);
    if (
      !snapshot.success ||
      !settings.success ||
      !knowledge.success ||
      canonicalJson(candidate.output) !== canonicalJson(candidate.paid_output) ||
      canonicalJson(snapshot.data) !== sameInput ||
      canonicalJson(settings.data) !== sameSettings
    )
      continue;
    const contextCheckpoint = await tx
      .selectFrom("proc.run_step")
      .select("output")
      .where("run_id", "=", candidate.run_id)
      .where("step", "=", "knowledge:input-context")
      .executeTakeFirst();
    let contextVerification: "server_input_checkpoint" | "legacy_output_fields";
    if (contextCheckpoint) {
      const context = knowledgeInputContextSchema.safeParse(contextCheckpoint.output);
      // A present but invalid/different checkpoint never falls back to legacy output.
      if (!context.success || canonicalJson(context.data) !== canonicalJson(currentContext))
        continue;
      contextVerification = "server_input_checkpoint";
    } else {
      // Old releases did not persist input metadata. Explicit owner retry may recover
      // an owned response only when its own context fields agree with today's lesson.
      // This is an output compatibility check, not proof of the historical prompt.
      const notes = knowledge.data.classNotes;
      if (
        !notes?.course ||
        !currentContext.course ||
        notes.date !== currentContext.date ||
        notes.course !== currentContext.course
      )
        continue;
      contextVerification = "legacy_output_fields";
    }
    // Preserve the original response byte-for-byte as JSON data. Do not copy attempts,
    // costs, repairs or reservations: the new run owns only its subsequent paid work.
    await tx
      .insertInto("proc.run_step")
      .values([
        {
          run_id: input.runId,
          step: "knowledge",
          output: JSON.stringify(candidate.output),
          completed_at: input.now,
        },
        {
          run_id: input.runId,
          step: "knowledge:reused",
          output: JSON.stringify({
            version: 1,
            sourceRunId: candidate.run_id,
            sourceAttemptId: candidate.attempt_id,
            sourceStep: candidate.paid_step,
            outputHash: sha256Hex(canonicalJson(candidate.output)),
            snapshotHash: sha256Hex(sameInput),
            settingsHash: sha256Hex(sameSettings),
            contextVerification,
            context: currentContext,
          }),
          completed_at: input.now,
        },
      ])
      .execute();
    if (contextVerification === "server_input_checkpoint")
      await tx
        .insertInto("proc.run_step")
        .values({
          run_id: input.runId,
          step: "knowledge:input-context",
          output: JSON.stringify(currentContext),
          completed_at: input.now,
        })
        .execute();
    return;
  }
}
