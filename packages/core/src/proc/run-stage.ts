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
