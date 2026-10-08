import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "@recalino/core/db";
import {
  AppError,
  createLogger,
  errors,
  type LearnerContext,
  readOwnedObject,
} from "@recalino/core/plt";
import { scheduleVoiceReanalysis, type VoiceDiarizer, voiceAnalysisJob } from "@recalino/core/proc";
import { liveTemporaryAudioObject } from "@recalino/core/src";
import { voiceCoverageReason } from "@recalino/core/voice-contracts";
import { getAiProvider } from "./ai";
import { decodeVoiceAudioWindows, type VoiceWindowCoverage } from "./audio-preparer";
import { getObjectStore } from "./storage";
import { loadVoiceEngine } from "./voice-engine";
import { remapVoiceSegments, voiceSourceWindows } from "./voice-source-windows";

const SAFE_CODE = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * One allow-listed diagnostic code per failed check (PRD-PRIV-06): never a path, URL, native
 * message, transcript text or anything derived from audio. The stored reason stays coarse.
 */
export function voiceFailureCode(error: unknown): string {
  if (error instanceof AppError) {
    const details = (error.details ?? {}) as { fields?: Record<string, unknown>; reason?: unknown };
    for (const key of ["voice", "audio"]) {
      const value = details.fields?.[key];
      if (Array.isArray(value) && typeof value[0] === "string" && SAFE_CODE.test(value[0]))
        return value[0];
    }
    if (typeof details.reason === "string" && SAFE_CODE.test(details.reason)) return details.reason;
    return SAFE_CODE.test(error.code) ? error.code : "app_error";
  }
  if (error instanceof Error && /^voice_[a-z0-9_]{1,58}$/.test(error.message)) return error.message;
  return "unexpected";
}

type CheckedDiarization = Awaited<ReturnType<VoiceDiarizer>> & {
  coverage?: VoiceWindowCoverage;
};

/** The full original establishes one speaker namespace; five-minute STT chunks do not. */
const diarizeOriginal = async ({
  db,
  ctx,
  source,
}: Parameters<VoiceDiarizer>[0]): Promise<CheckedDiarization> => {
  const store = getObjectStore();
  if (!store || !source.objectId || !source.durationMs)
    throw errors.validationFailed({ voice: ["original_audio_unavailable"] });
  if (!(await liveTemporaryAudioObject(db, ctx, source.sourceId, source.objectId)))
    throw errors.validationFailed({ voice: ["original_audio_unavailable"] });
  const engine = await loadVoiceEngine();
  const bytes = await readOwnedObject(db, store, ctx, source.objectId);
  let samples: Float32Array | undefined;
  try {
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
      throw errors.validationFailed({ voice: ["source_integrity_mismatch"] });
    const selection = voiceSourceWindows(source.durationMs, source.ranges);
    const pcm = await decodeVoiceAudioWindows(bytes, selection.windows);
    samples = pcm.samples;
    const result = await engine.diarize(pcm.samples, {
      sampleRate: pcm.sampleRate,
      boundaries: pcm.windows.flatMap((window) => [window.compositeStartMs, window.compositeEndMs]),
    });
    return {
      ...result,
      segments: remapVoiceSegments(result.segments, pcm.windows),
      // Planned sampling and skipped or shortened excerpts are disclosed separately.
      ...(selection.sampled ? { sampled: true } : {}),
      ...(pcm.partial ? { partial: true } : {}),
      coverage: pcm.coverage,
    };
  } finally {
    samples?.fill(0);
    bytes.fill(0);
  }
};

export const diarizeSourceVoice: VoiceDiarizer = async (input) => {
  const log = createLogger();
  const started = performance.now();
  try {
    const { coverage, ...result } = await diarizeOriginal(input);
    log("info", "voice_check_diarized", {
      code: voiceCoverageReason(!!result.sampled, !!result.partial) ?? "complete_audio",
      duration_ms: Math.round(performance.now() - started),
      // Integer attrition only: how many excerpts were planned, used, refused or too short.
      windows_planned: coverage?.plannedWindows,
      windows_used: coverage?.usedWindows,
      windows_refused: coverage?.refusedWindows,
      windows_short: coverage?.shortWindows,
      audio_planned_ms: coverage?.plannedMs,
      audio_used_ms: coverage?.usedMs,
      request_id: input.ctx.requestId,
      user_id: input.ctx.userId,
      module: "voc",
    });
    return result;
  } catch (error) {
    log("warn", "voice_check_failed", {
      code: voiceFailureCode(error),
      error_name: error instanceof Error ? error.name : "unknown",
      duration_ms: Math.round(performance.now() - started),
      request_id: input.ctx.requestId,
      user_id: input.ctx.userId,
      module: "voc",
    });
    throw error;
  }
};

export function getVoiceAnalysisDefinition() {
  if (!getObjectStore()) return null;
  return voiceAnalysisJob({ provider: getAiProvider(), diarize: diarizeSourceVoice });
}

export function queueVoiceAnalysis(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  operationKey?: string,
) {
  return scheduleVoiceReanalysis(
    db,
    ctx,
    sessionId,
    {
      provider: getAiProvider(),
      diarize: diarizeSourceVoice,
    },
    { operationKey },
  );
}
