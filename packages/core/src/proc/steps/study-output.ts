import { ProviderError } from "../../aip";
import type { Database, Tx } from "../../db";
import { AppError, type JobContext } from "../../plt";
import type { AssemblyTolerance } from "../knowledge-generation";
import { assemblyOmissionsSchema, assemblyOmissionsStep } from "../knowledge-generation-step";
import {
  type AssemblyOmissions,
  productionCards,
  type StudyOutputAudit,
} from "../study-output-guard";
import type { ValidatedKnowledge } from "./legacy-knowledge-repair";
import { cached, saveStep } from "./runtime";

/** D110: a tolerant assembly's omissions, saved in the same commit as their checkpoint. */
export async function saveAssemblyOmissions(
  tx: Tx,
  runId: string,
  checkpoint: string,
  tolerance: AssemblyTolerance,
  now: Date,
) {
  if (!tolerance.omissions) return;
  await saveStep(
    tx,
    runId,
    assemblyOmissionsStep(checkpoint),
    assemblyOmissionsSchema.parse({ version: 1, ...tolerance.omissions }),
    now,
  );
}

/** D110: what the assembly omitted from a saved checkpoint, counted toward its allowance. */
export async function assemblyOmissions(
  db: Database | Tx,
  runId: string,
  checkpoint: string,
): Promise<AssemblyOmissions | null> {
  const marker = await cached(
    db,
    runId,
    assemblyOmissionsStep(checkpoint),
    assemblyOmissionsSchema,
  );
  return marker ? { omitted: marker.omitted, omittedProduction: marker.omittedProduction } : null;
}

/**
 * D110: a single repair that left nothing usable: a definite provider failure (including a
 * refused second dispatch) or a repaired lesson or answer-span result that does not validate.
 * An uncertain provider outcome and a cancelled job are never treated as unusable.
 */
function unusableRepair(error: unknown): boolean {
  if (error instanceof ProviderError) return !error.uncertain;
  return error instanceof AppError && error.code === "validation_failed";
}

/**
 * D110: the result of the one bounded repair, compared with the bounded original. The repaired
 * lesson wins unless the original keeps more production cards. When the repair left nothing
 * usable, the bounded original is used; without it the repair's own failure stands, exactly as
 * before. After a provider failure the job ends ("checkpoint"): a paid call never shares a job
 * with publishing, and the next job publishes the original through its first validation.
 */
export async function preferRepaired(
  original: (() => ValidatedKnowledge) | null,
  repair: () => Promise<"checkpoint" | ValidatedKnowledge>,
): Promise<"checkpoint" | ValidatedKnowledge> {
  const kept = () => {
    try {
      return original?.() ?? null;
    } catch {
      return null;
    }
  };
  let repaired: "checkpoint" | ValidatedKnowledge;
  try {
    repaired = await repair();
  } catch (error) {
    if (!unusableRepair(error)) throw error;
    const fallback = kept();
    if (!fallback) throw error;
    return error instanceof ProviderError ? "checkpoint" : fallback;
  }
  if (repaired === "checkpoint") return repaired;
  const fallback = kept();
  return fallback && productionCards(fallback.model) > productionCards(repaired.model)
    ? fallback
    : repaired;
}

/** D110: one log line of code-owned counts when the guard changed the lesson (PRD-PRIV-06). */
export function logStudyOutput(job: JobContext, audit: StudyOutputAudit) {
  const dropped = Object.values(audit.droppedItems).reduce((sum, value) => sum + value, 0);
  const omitted = Object.values(audit.assemblyOmitted).reduce((sum, value) => sum + value, 0);
  const rebuilt = audit.gapsRebuilt.spacing + audit.gapsRebuilt.derivedBlank;
  if (!dropped && !omitted && !rebuilt && !audit.trimmedOverLimit) return;
  job.log?.("info", "study_output_guard", {
    module: "proc",
    job_id: job.job.id,
    version: audit.version,
    production_limit: audit.productionLimit,
    gaps_spacing: audit.gapsRebuilt.spacing,
    gaps_derived_blank: audit.gapsRebuilt.derivedBlank,
    dropped,
    trimmed_over_limit: audit.trimmedOverLimit,
    unlinked_mistakes: audit.unlinkedMistakes,
    assembly_omitted: omitted,
    ...Object.fromEntries(
      Object.entries(audit.droppedItems).map(([code, value]) => [`dropped.${code}`, value]),
    ),
    ...Object.fromEntries(
      Object.entries(audit.assemblyOmitted).map(([code, value]) => [`omitted.${code}`, value]),
    ),
  });
}
