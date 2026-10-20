import { ProviderError } from "../../aip";
import type { Database, Tx } from "../../db";
import { AppError, type JobContext } from "../../plt";
import type { AssemblyTolerance } from "../knowledge-generation";
import { assemblyOmissionsSchema, assemblyOmissionsStep } from "../knowledge-generation-step";
import {
  type AssemblyOmissions,
  productionCards,
  type StudyOutputAudit,
  studyCount,
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
  return marker
    ? {
        omitted: marker.omitted,
        omittedProduction: marker.omittedProduction,
        first: marker.first,
      }
    : null;
}

/**
 * D110: a response with assembly omissions that the guard cannot accept takes the recovery it
 * took before the tolerance: its assembly failed, so the regeneration is asked as a schema
 * recovery with the first omitted item's code (`assembly:<code>`).
 */
export function assemblyRecovery(omissions: AssemblyOmissions) {
  return {
    repairReason: "provider_schema_invalid" as const,
    repairDetail: `assembly:${omissions.first}`,
  };
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

/** The most frequent code of a count record (ties alphabetical), for the log's `code` field. */
function mainCode(counts: Readonly<Record<string, number>>): string | undefined {
  return Object.entries(counts).sort(
    ([code, value], [other, otherValue]) => otherValue - value || code.localeCompare(other),
  )[0]?.[0];
}

/**
 * D110: one log line of code-owned counts when the guard changed the lesson (PRD-PRIV-06): the
 * guard version, integers and the most frequent removal code, all allow-listed in plt/log.ts.
 */
export function logStudyOutput(job: JobContext, audit: StudyOutputAudit) {
  const dropped = studyCount(audit.droppedItems);
  const omitted = studyCount(audit.assemblyOmitted);
  const rebuilt = audit.gapsRebuilt.spacing + audit.gapsRebuilt.derivedBlank;
  if (!dropped && !omitted && !rebuilt && !audit.trimmedOverLimit) return;
  const code = mainCode(audit.droppedItems) ?? mainCode(audit.assemblyOmitted);
  job.log?.("info", "study_output_guard", {
    module: "proc",
    job_id: job.job.id,
    guard_version: audit.version,
    production_limit: audit.productionLimit,
    gaps_spacing: audit.gapsRebuilt.spacing,
    gaps_derived_blank: audit.gapsRebuilt.derivedBlank,
    dropped,
    trimmed_over_limit: audit.trimmedOverLimit,
    unlinked_mistakes: audit.unlinkedMistakes,
    assembly_omitted: omitted,
    ...(code ? { code } : {}),
  });
}
