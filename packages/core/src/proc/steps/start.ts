import { requireProvider } from "../../aip";
import { canonicalJson, errors } from "../../plt";
import { runSettingsSchema, sourceSnapshotSchema } from "../contracts";
import type { ProcessingRun } from "./context";
import { liveRun } from "./runtime";
import { visionContract } from "./vision";

/** First stage: marks the run processing and reads the settings and sources frozen at its start. */
export async function startRun(
  base: Pick<ProcessingRun, "job" | "ctx" | "payload" | "definition" | "dependencies">,
): Promise<ProcessingRun> {
  const { job, ctx, payload, dependencies } = base;
  const provider = requireProvider(dependencies.provider);
  const initial = await job.db.transaction().execute(async (tx) => {
    const run = await liveRun(tx, ctx, payload.runId);
    await tx
      .updateTable("proc.processing_run")
      .set({ state: "processing", updated_at: job.now() })
      .where("id", "=", run.id)
      .execute();
    return run;
  });
  const settings = runSettingsSchema.parse(initial.settings);
  if (canonicalJson(settings.provider) !== canonicalJson(provider.settings))
    throw errors.validationFailed({ provider: ["settings_changed"] });
  const snapshot = sourceSnapshotSchema.parse(initial.input_snapshot);
  const vision = visionContract(settings.provider.lessonQuality);
  return { ...base, provider, initial, settings, snapshot, vision };
}
