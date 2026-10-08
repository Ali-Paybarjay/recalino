import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { QualifiedVoiceSegment } from "./voice-engine-quality.mjs";

export { cosineSimilarity, poolEmbeddings } from "./voice-engine-quality.mjs";
export const VOICE_MODEL_REVISION =
  "sherpa-onnx-1.13.8_pyannote3-220ad67c_wespeaker-resnet34lm-e9848563";
/**
 * Agglomerative speaker-grouping distance. It decides which turns form one voice, never whether
 * a voice is the learner. Speaker vectors stay in the same embedding space for any value.
 */
export const VOICE_CLUSTER_THRESHOLD = 0.5;
/** Which speech of a voice forms its voiceprint (see embeddingSpans). */
export type VoiceSpanMode = "whole-turns" | "clean-parts";
export const VOICE_SPAN_MODE: VoiceSpanMode = "whole-turns";
/** Pooled-voice similarity at which over-split voices are merged; null leaves them as found. */
export const VOICE_MERGE_THRESHOLD: number | null = null;
export type VoiceSegment = QualifiedVoiceSegment;
export type VoiceDiarization = {
  modelRevision: string;
  segments: VoiceSegment[];
  speakers: { speakerId: string; embedding: number[]; cleanSpeechMs: number }[];
};
export interface VoiceEngine {
  readonly modelRevision: string;
  diarize(
    samples: Float32Array,
    options?: { sampleRate?: number; offsetMs?: number; boundaries?: number[] },
  ): Promise<VoiceDiarization>;
  embed(samples: Float32Array, sampleRate?: number): Promise<number[]>;
}
type Configuration = {
  segmentationPath: string;
  embeddingPath: string;
  modelRevision: string;
  clusterThreshold: number;
  spanMode: VoiceSpanMode;
  mergeThreshold: number | null;
  numThreads: number;
  timeoutMs: number;
};

/** Reject a malformed waveform before it enters native code. This engine accepts decoded mono PCM only. */
export function validateVoicePcm(samples: Float32Array, sampleRate = 16000) {
  if (
    sampleRate !== 16000 ||
    !(samples instanceof Float32Array) ||
    samples.length < 32000 ||
    samples.length > 16000 * 7200
  )
    throw new Error("voice_pcm_invalid");
  for (const value of samples)
    if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error("voice_pcm_invalid");
}

/** Fixed codes the worker and its quality helpers raise; anything else stays generic. */
const WORKER_FAILURE_CODES = new Set([
  "voice_runtime_version_mismatch",
  "voice_model_sample_rate_mismatch",
  "voice_diarization_output_invalid",
  "voice_speech_too_short",
  "voice_embedding_dimension_mismatch",
  "voice_embedding_invalid",
  "voice_embedding_empty",
  "voice_embedding_pool_invalid",
]);
export function workerFailureCode(code: unknown): string {
  return typeof code === "string" && WORKER_FAILURE_CODES.has(code)
    ? code
    : "voice_inference_failed";
}

let running: Promise<unknown> = Promise.resolve();
let pending = 0;
function workerPath(): string {
  // Keep the worker as a traced source asset; webpack cannot inline its relative native imports.
  const candidates = [
    resolve(process.cwd(), "src/server/voice-engine-worker.mjs"),
    resolve(process.cwd(), "apps/web/src/server/voice-engine-worker.mjs"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("voice_worker_missing");
  return path;
}
function execute<T>(
  operation: "embed" | "diarize",
  samples: Float32Array,
  configuration: Configuration,
  offsetMs = 0,
  boundaries: number[] = [],
): Promise<T> {
  if (pending >= 2) return Promise.reject(new Error("voice_engine_busy"));
  pending++;
  // Capture before queueing: validation and inference must see the same samples.
  const ownedSamples = Float32Array.from(samples);
  const task = running
    .catch(() => {})
    .then(
      () =>
        new Promise<T>((accept, reject) => {
          const worker = new Worker(workerPath(), {
            workerData: { operation, samples: ownedSamples, configuration, offsetMs, boundaries },
            transferList: [ownedSamples.buffer],
          });
          let finished = false;
          const timer = setTimeout(
            () => finish(new Error("voice_inference_timeout")),
            configuration.timeoutMs,
          );
          const finish = (error?: Error, value?: T) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            void worker.terminate().finally(() => (error ? reject(error) : accept(value as T)));
          };
          worker.once("message", (message: { ok: boolean; value?: T; error?: unknown }) =>
            message.ok
              ? finish(undefined, message.value)
              : finish(new Error(workerFailureCode(message.error))),
          );
          worker.once("error", () => finish(new Error("voice_inference_failed")));
          worker.once("exit", () => {
            if (!finished) finish(new Error("voice_worker_interrupted"));
          });
        }),
    );
  const settled = task.finally(() => {
    pending--;
  });
  running = settled;
  return settled;
}

/**
 * Pinned weights are explicitly provisioned by the operator; runtime never downloads models.
 * `clusterThreshold`, `spanMode` and `mergeThreshold` exist for the offline pipeline evaluation;
 * the app uses the defaults.
 */
export async function loadVoiceEngine(
  options: {
    clusterThreshold?: number;
    spanMode?: VoiceSpanMode;
    mergeThreshold?: number | null;
  } = {},
): Promise<VoiceEngine> {
  // Build-provisioned weights are traced beside the source worker into each native function.
  // Explicit absolute paths remain available for an operator-managed installation.
  const modelRoot = resolve(dirname(workerPath()), "../../../../tools/voice/models");
  const segmentationPath =
    process.env.VOICE_SEGMENTATION_MODEL_PATH ??
    resolve(modelRoot, "sherpa-onnx-pyannote-segmentation-3-0/model.onnx");
  const embeddingPath =
    process.env.VOICE_EMBEDDING_MODEL_PATH ??
    resolve(modelRoot, "wespeaker_en_voxceleb_resnet34_LM.onnx");
  if (
    !segmentationPath ||
    !embeddingPath ||
    !isAbsolute(segmentationPath) ||
    !isAbsolute(embeddingPath)
  )
    throw new Error("voice_models_not_configured");
  const models = [
    [segmentationPath, "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"],
    [embeddingPath, "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012"],
  ] as const;
  for (const [path, expected] of models) {
    const actual = createHash("sha256")
      .update(
        await readFile(path).catch(() => {
          throw new Error("voice_models_not_configured");
        }),
      )
      .digest("hex");
    if (actual !== expected) throw new Error("voice_model_integrity_mismatch");
  }
  const configuration: Configuration = {
    segmentationPath,
    embeddingPath,
    modelRevision: VOICE_MODEL_REVISION,
    clusterThreshold: options.clusterThreshold ?? VOICE_CLUSTER_THRESHOLD,
    spanMode: options.spanMode ?? VOICE_SPAN_MODE,
    mergeThreshold:
      options.mergeThreshold === undefined ? VOICE_MERGE_THRESHOLD : options.mergeThreshold,
    numThreads: 2,
    timeoutMs: 600000,
  };
  return {
    modelRevision: VOICE_MODEL_REVISION,
    diarize(samples, options = {}) {
      validateVoicePcm(samples, options.sampleRate);
      const offsetMs = options.offsetMs ?? 0;
      if (!Number.isSafeInteger(offsetMs) || offsetMs < 0) throw new Error("voice_offset_invalid");
      const boundaries = options.boundaries ?? [];
      if (
        boundaries.some(
          (boundary) =>
            !Number.isSafeInteger(boundary) || boundary < 0 || boundary > samples.length / 16,
        )
      )
        throw new Error("voice_boundary_invalid");
      return execute<VoiceDiarization>("diarize", samples, configuration, offsetMs, boundaries);
    },
    embed(samples, sampleRate = 16000) {
      validateVoicePcm(samples, sampleRate);
      if (samples.length > 16000 * 120) throw new Error("voice_enrolment_too_long");
      return execute<number[]>("embed", samples, configuration);
    },
  };
}

/** Operator smoke check. Synthetic PCM exercises the native networks without reading user data. */
export async function checkVoiceRuntime() {
  const started = performance.now();
  const engine = await loadVoiceEngine();
  const pcm = new Float32Array(6 * 16000);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / 16000;
    const envelope = Math.min(1, t * 10, (6 - t) * 10);
    pcm[i] =
      envelope *
      (0.2 * Math.sin(2 * Math.PI * (140 * t + 3 * t * t)) +
        0.08 * Math.sin(2 * Math.PI * 280 * t));
  }
  try {
    const embedding = await engine.embed(pcm);
    const norm = Math.hypot(...embedding);
    if (embedding.length !== 256 || !embedding.every(Number.isFinite) || Math.abs(norm - 1) > 0.001)
      throw new Error("voice_native_smoke_embedding_invalid");
    const result = await engine.diarize(pcm);
    if (
      result.modelRevision !== engine.modelRevision ||
      !Array.isArray(result.segments) ||
      !Array.isArray(result.speakers)
    )
      throw new Error("voice_native_smoke_diarization_invalid");
    return {
      platform: platform(),
      architecture: arch(),
      modelRevision: engine.modelRevision,
      source: "synthetic harmonic PCM, no person recorded",
      embedding: "passed",
      diarization: "passed",
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    pcm.fill(0);
  }
}
