import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import {
  embeddingSpans,
  mergeVoices,
  normalizeEmbedding,
  poolEmbeddings,
  qualifySegments,
} from "./voice-engine-quality.mjs";

// This module is an isolated CPU worker. User audio never leaves this process or reaches a URL.
if (!parentPort) throw new Error("voice_worker_requires_parent");
try {
  const require = createRequire(import.meta.url);
  const sherpa = require("sherpa-onnx-node");
  if (require("sherpa-onnx-node/package.json").version !== "1.13.8")
    throw new Error("voice_runtime_version_mismatch");
  const { samples, configuration, operation, offsetMs, boundaries = [] } = workerData;
  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: configuration.embeddingPath,
    numThreads: configuration.numThreads,
    provider: "cpu",
    debug: false,
  });
  const embed = (pcm) => {
    const stream = extractor.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: pcm });
    if (!extractor.isReady(stream)) throw new Error("voice_speech_too_short");
    const embedding = normalizeEmbedding(extractor.compute(stream, false));
    if (embedding.length !== 256) throw new Error("voice_embedding_dimension_mismatch");
    return embedding;
  };
  if (operation === "embed") parentPort.postMessage({ ok: true, value: embed(samples) });
  else {
    const diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: configuration.segmentationPath, windowShiftRatio: 0.1 },
        numThreads: configuration.numThreads,
        provider: "cpu",
        debug: false,
      },
      embedding: {
        model: configuration.embeddingPath,
        numThreads: configuration.numThreads,
        provider: "cpu",
        debug: false,
      },
      clustering: { numClusters: -1, threshold: configuration.clusterThreshold },
      minDurationOn: 0.2,
      // Preserve brief changes of speaker; broad off-gap merging would contaminate voiceprints.
      minDurationOff: 0,
    });
    if (diarizer.sampleRate !== 16000) throw new Error("voice_model_sample_rate_mismatch");
    // One span is embedded once, whether for merging voices or for the final voiceprint.
    const vectors = new Map();
    const embedSpan = (span) => {
      const key = `${span.startMs}:${span.endMs}`;
      if (!vectors.has(key))
        vectors.set(
          key,
          embed(
            samples.subarray(
              Math.round((span.startMs - offsetMs) * 16),
              Math.round((span.endMs - offsetMs) * 16),
            ),
          ),
        );
      return vectors.get(key);
    };
    const qualified = qualifySegments(
      diarizer.process(samples),
      samples.length / 16,
      offsetMs,
      boundaries,
    );
    const segments =
      configuration.mergeThreshold === null
        ? qualified
        : mergeVoices(qualified, embedSpan, configuration.mergeThreshold);
    const speakers = [];
    for (const speakerId of new Set(segments.map((segment) => segment.speakerId))) {
      const spans = embeddingSpans(segments, speakerId, configuration.spanMode);
      if (!spans.length) continue;
      const embeddings = spans.map((span) => ({
        embedding: embedSpan(span),
        weight: span.endMs - span.startMs,
      }));
      speakers.push({
        speakerId,
        embedding: poolEmbeddings(embeddings),
        cleanSpeechMs: embeddings.reduce((sum, entry) => sum + entry.weight, 0),
      });
    }
    parentPort.postMessage({
      ok: true,
      value: { modelRevision: configuration.modelRevision, segments, speakers },
    });
  }
} catch (error) {
  // Native errors can contain absolute paths; neither diagnostics nor audio belongs in a response.
  // Only this module's own fixed `voice_*` codes cross the boundary; anything else is generic.
  const code =
    error instanceof Error && /^voice_[a-z0-9_]{1,58}$/.test(error.message)
      ? error.message
      : "voice_inference_failed";
  parentPort.postMessage({ ok: false, error: code });
}
