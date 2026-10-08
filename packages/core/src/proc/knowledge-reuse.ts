import type { z } from "zod";
import type { AiProvider } from "../aip";
import type { Tx } from "../db";
import { getCourse, getSession } from "../org";
import { canonicalJson, type LearnerContext, sha256Hex } from "../plt";
import { providerAccountingProvenanceQueries } from "../quota";
import { type RunSnapshot, runSettingsSchema, sourceSnapshotSchema } from "./contracts";
import { generatedKnowledgeSchema } from "./generated-knowledge";
import { knowledgeInputContextSchema } from "./knowledge-input-context";
import { buildKnowledgeRepairInput } from "./knowledge-repair";

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
  if (!candidates.length) return;
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
    // Preserve the original response byte-for-byte as JSON data. Never copy attempts,
    // costs or reservations; a paid repair has its own validation below.
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
    await reuseCompletedKnowledgeRepair(tx, ctx, input, candidate.output, currentContext);
    return;
  }
}

/** A completed repair is reusable only after its exact evidence-key response validates today. */
async function reuseCompletedKnowledgeRepair(
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
  knowledge: unknown,
  context: z.infer<typeof knowledgeInputContextSchema>,
): Promise<void> {
  const accounting = providerAccountingProvenanceQueries(tx, ctx, input.sessionId);
  const candidates = await tx
    .selectFrom("proc.processing_run as run")
    .innerJoin("proc.run_step as original", (join) =>
      join.onRef("original.run_id", "=", "run.id").on("original.step", "=", "knowledge"),
    )
    .innerJoin("proc.run_step as checkpoint", (join) =>
      join.onRef("checkpoint.run_id", "=", "run.id").on("checkpoint.step", "=", "knowledge:repair"),
    )
    .innerJoin("proc.provider_attempt as attempt", (join) =>
      join.onRef("attempt.run_id", "=", "run.id").onRef("attempt.step", "=", "checkpoint.step"),
    )
    .innerJoin(accounting.costs.as("cost"), "cost.attempt_id", "attempt.id")
    .innerJoin(accounting.closedHolds.as("hold"), "hold.id", "attempt.hold_id")
    .select([
      "run.id as run_id",
      "run.input_snapshot",
      "run.settings",
      "original.output as knowledge",
      "checkpoint.output",
      "attempt.id as attempt_id",
    ])
    .where("run.user_id", "=", ctx.userId)
    .where("run.session_id", "=", input.sessionId)
    .where("run.kind", "=", "class")
    .where("run.state", "in", ["failed", "needs_input"])
    .where("run.id", "!=", input.runId)
    .where("run.sources_version", "=", input.snapshot.sourcesVersion)
    .where("run.source_fingerprint", "=", input.snapshot.fingerprint)
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
  if (!candidates.length) return;
  const sameInput = canonicalJson(input.snapshot);
  const sameSettings = canonicalJson(input.settings);
  const sameKnowledge = canonicalJson(knowledge);
  // Use the same selected native units as the worker; no locator is broadened.
  const sources = input.snapshot.sources.map((source) => {
    if (!source.ranges.length) return source;
    const units = source.units.filter((unit) =>
      source.ranges.some((range) =>
        unit.kind === "page"
          ? unit.start >= range.start && unit.start <= range.end
          : unit.kind === "time"
            ? unit.start >= range.start && (unit.end ?? unit.start) <= range.end
            : true,
      ),
    );
    return {
      ...source,
      units,
      blocks: source.blocks.filter((block) => units.some((unit) => unit.id === block.unitId)),
    };
  });
  const missingSourceIds = sources
    .filter(
      (source) => !source.blocks.length || source.units.some((unit) => unit.status !== "extracted"),
    )
    .map((source) => source.sourceId);
  const repair = buildKnowledgeRepairInput(
    {
      sources,
      explanationLanguage: input.settings.explanationLanguage,
      teachingPreferences: input.settings.teachingPreferences,
      ...(input.settings.learnerContext ? { learnerContext: input.settings.learnerContext } : {}),
      missingSourceIds,
      lessonContext: context,
    },
    input.settings.provider.maxInputCharacters,
  );
  for (const candidate of candidates) {
    const snapshot = sourceSnapshotSchema.safeParse(candidate.input_snapshot);
    const settings = runSettingsSchema.safeParse(candidate.settings);
    if (
      !snapshot.success ||
      !settings.success ||
      canonicalJson(snapshot.data) !== sameInput ||
      canonicalJson(settings.data) !== sameSettings ||
      canonicalJson(candidate.knowledge) !== sameKnowledge ||
      !repair.schema.safeParse(candidate.output).success
    )
      continue;
    const metadata = await tx
      .selectFrom("proc.run_step")
      .select("output")
      .where("run_id", "=", candidate.run_id)
      .where("step", "=", "knowledge:input-context")
      .executeTakeFirst();
    const checkedContext = knowledgeInputContextSchema.safeParse(metadata?.output);
    if (!checkedContext.success || canonicalJson(checkedContext.data) !== canonicalJson(context))
      continue;
    try {
      // A known paid result can become valid after a compatibility fix, but every
      // evidence, language, identity and question/answer guard still applies.
      repair.decode(candidate.output);
    } catch {
      continue;
    }
    await tx
      .insertInto("proc.run_step")
      .values([
        {
          run_id: input.runId,
          step: "knowledge:repair",
          output: JSON.stringify(candidate.output),
          completed_at: input.now,
        },
        {
          run_id: input.runId,
          step: "knowledge:repair-reused",
          output: JSON.stringify({
            version: 1,
            sourceRunId: candidate.run_id,
            sourceAttemptId: candidate.attempt_id,
            sourceStep: "knowledge:repair",
            outputHash: sha256Hex(canonicalJson(candidate.output)),
            knowledgeHash: sha256Hex(sameKnowledge),
            snapshotHash: sha256Hex(sameInput),
            settingsHash: sha256Hex(sameSettings),
            context,
          }),
          completed_at: input.now,
        },
      ])
      .execute();
    return;
  }
}
