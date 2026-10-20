import { z } from "zod";
import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
import { getVoiceEnrollment } from "../voc";

/**
 * What a processing run is doing after its lesson is written, for the learner's status line.
 * The notes are published only after the voice check (owner decision 2026-10-12 rejected
 * publishing before it), so a finished lesson can wait for minutes on that check.
 */
export type RunFinishingStage = "checking_voices" | "publishing";

// Only the source kinds matter here; a loose read survives later snapshot fields.
const snapshotKinds = z.object({ sources: z.array(z.object({ kind: z.string() })) });

/** Pure decision, separated for unit tests. */
export function finishingStage(input: {
  state: string;
  lessonWritten: boolean;
  snapshot: unknown;
  voiceEnabled: boolean;
}): RunFinishingStage | null {
  if (input.state !== "processing" || !input.lessonWritten) return null;
  const snapshot = snapshotKinds.safeParse(input.snapshot);
  const audio = snapshot.success && snapshot.data.sources.some((source) => source.kind === "audio");
  return audio && input.voiceEnabled ? "checking_voices" : "publishing";
}

/** Read-only and owner-scoped: no step of the run is started or changed. */
export async function runFinishingStage(
  db: Database | Tx,
  ctx: LearnerContext,
  runId: string,
): Promise<RunFinishingStage | null> {
  const run = await db
    .selectFrom("proc.processing_run")
    .select(["state", "input_snapshot"])
    .where("id", "=", runId)
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (run?.state !== "processing") return null;
  const written = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", runId)
    .where("step", "=", "knowledge")
    .executeTakeFirst();
  if (!written) return null;
  return finishingStage({
    state: run.state,
    lessonWritten: true,
    snapshot: run.input_snapshot,
    voiceEnabled: (await getVoiceEnrollment(db, ctx)).enabled,
  });
}

/**
 * PERF-04: runFinishingStage for many runs in a constant number of reads, keyed by run: one read
 * of the owned processing runs whose lesson step is written and, only when a lesson is written,
 * one voice enrollment read.
 */
export async function runFinishingStages(
  db: Database | Tx,
  ctx: LearnerContext,
  runIds: readonly string[],
): Promise<Map<string, RunFinishingStage | null>> {
  const ids = [...new Set(runIds)];
  const stages = new Map<string, RunFinishingStage | null>(ids.map((id) => [id, null]));
  if (!ids.length) return stages;
  // runFinishingStage's run read and lesson-step check, as one statement.
  const written = await db
    .selectFrom("proc.processing_run as run")
    .select(["run.id", "run.input_snapshot"])
    .where("run.id", "in", ids)
    .where("run.user_id", "=", ctx.userId)
    .where("run.state", "=", "processing")
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("proc.run_step as step")
          .select("step.run_id")
          .whereRef("step.run_id", "=", "run.id")
          .where("step.step", "=", "knowledge"),
      ),
    )
    .execute();
  if (!written.length) return stages;
  const voiceEnabled = (await getVoiceEnrollment(db, ctx)).enabled;
  for (const run of written)
    stages.set(
      run.id,
      finishingStage({
        state: "processing",
        lessonWritten: true,
        snapshot: run.input_snapshot,
        voiceEnabled,
      }),
    );
  return stages;
}
