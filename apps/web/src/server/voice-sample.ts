import "server-only";
import { errors } from "@recalino/core/plt";
import { decodeVoiceAudio } from "./audio-preparer";
import type { VoiceEngine } from "./voice-engine";

/** Half a second of silence on each side of a sample (16 kHz). */
const SAMPLE_MARGIN = 8000;

/**
 * The checks a personal voice sample passes before it can be stored: size, a 15–35 second
 * duration and exactly one clear voice with at least 15 seconds of clean speech. The same
 * function serves the enrolment route and the offline evaluation (tools/voice/evaluation).
 */
export async function prepareVoiceSample(
  loadEngine: () => Promise<VoiceEngine>,
  bytes: Uint8Array,
): Promise<{ embedding: number[]; durationMs: number; modelRevision: string }> {
  if (bytes.byteLength > 2100000 || !bytes.byteLength)
    throw errors.validationFailed({ audio: ["voice_sample_size"] });
  const engine = await loadEngine().catch(() => {
    throw errors.validationFailed({ voice: ["voice_engine_unavailable"] });
  });
  const pcm = await decodeVoiceAudio(bytes, 36000);
  let padded: Float32Array | undefined;
  try {
    if (pcm.durationMs < 15000 || pcm.durationMs > 35000)
      throw errors.validationFailed({ audio: ["voice_sample_duration"] });
    // Speech that runs up to the automatic stop (or starts at once) touches the recording edge,
    // and the class rule discards edge-clipped turns. A sample has no neighbouring speaker to
    // clip, so short silent margins keep that speech; the one-voice checks below are unchanged.
    padded = new Float32Array(pcm.samples.length + 2 * SAMPLE_MARGIN);
    padded.set(pcm.samples, SAMPLE_MARGIN);
    const diarized = await engine.diarize(padded, { sampleRate: pcm.sampleRate });
    const ids = new Set(diarized.segments.map((segment) => segment.speakerId));
    if (
      ids.size !== 1 ||
      diarized.speakers.length !== 1 ||
      (diarized.speakers[0]?.cleanSpeechMs ?? 0) < 15000
    )
      throw errors.validationFailed({ audio: ["one_clear_voice_required"] });
    const embedding = diarized.speakers[0]?.embedding;
    if (!embedding) throw errors.validationFailed({ audio: ["one_clear_voice_required"] });
    return {
      embedding,
      durationMs: Math.round(pcm.durationMs),
      modelRevision: engine.modelRevision,
    };
  } finally {
    pcm.samples.fill(0);
    padded?.fill(0);
  }
}
