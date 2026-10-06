import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "@recalino/core/db";
import { errors, type LearnerContext, readOwnedObject } from "@recalino/core/plt";
import { scheduleVoiceReanalysis, type VoiceDiarizer, voiceAnalysisJob } from "@recalino/core/proc";
import { getAiProvider } from "./ai";
import { decodeVoiceAudio } from "./audio-preparer";
import { getObjectStore } from "./storage";
import { loadVoiceEngine } from "./voice-engine";

/** The full original establishes one speaker namespace; five-minute STT chunks do not. */
export const diarizeSourceVoice: VoiceDiarizer = async ({ db, ctx, source }) => {
  const store = getObjectStore();
  if (!store || !source.objectId || !source.durationMs)
    throw errors.validationFailed({ voice: ["original_audio_unavailable"] });
  const engine = await loadVoiceEngine();
  const bytes = await readOwnedObject(db, store, ctx, source.objectId);
  let samples: Float32Array | undefined;
  try {
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
      throw errors.validationFailed({ voice: ["source_integrity_mismatch"] });
    const pcm = await decodeVoiceAudio(bytes, source.durationMs + 1000);
    samples = pcm.samples;
    return await engine.diarize(pcm.samples, { sampleRate: pcm.sampleRate });
  } finally {
    samples?.fill(0);
    bytes.fill(0);
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
