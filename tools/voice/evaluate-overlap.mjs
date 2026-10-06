import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadVoiceEngine } from "../../apps/web/src/server/voice-engine.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(await readFile(join(here, "models.manifest.json"), "utf8"));
const heldout = JSON.parse(await readFile(join(here, "evaluation-long-turns.json"), "utf8"));
process.env.VOICE_SEGMENTATION_MODEL_PATH = join(here, "models", manifest.segmentation.path);
process.env.VOICE_EMBEDDING_MODEL_PATH = join(here, "models", manifest.embedding.path);
const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ffmpeg = appRequire("ffmpeg-static");
function decode(name) {
  const [speaker, chapter] = name.split("-");
  const path = join(here, "evaluation-data/LibriSpeech/test-clean", speaker, chapter, name);
  const result = spawnSync(
    ffmpeg,
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      path,
      "-f",
      "f32le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "pipe:1",
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error("evaluation_decode_failed");
  return Float32Array.from({ length: result.stdout.length / 4 }, (_, index) =>
    result.stdout.readFloatLE(index * 4),
  );
}
const fileA = heldout.dataset.sourceFiles["1089"].evaluation[0];
const fileB = heldout.dataset.sourceFiles["121"].evaluation[0];
const a = decode(fileA),
  b = decode(fileB);
const overlapLength = Math.min(a.length, b.length, 16000 * 8);
const silence = new Float32Array(16000);
const mixed = new Float32Array(overlapLength);
for (let index = 0; index < overlapLength; index++) mixed[index] = (a[index] + b[index]) * 0.45;
const parts = [silence, a, silence, b, silence, mixed, silence, a, silence, b, silence];
const samples = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
let cursor = 0;
for (const part of parts) {
  samples.set(part, cursor);
  cursor += part.length;
}
const startMs = (silence.length * 3 + a.length + b.length) / 16;
const endMs = startMs + overlapLength / 16;
const engine = await loadVoiceEngine();
const started = performance.now();
const analysis = await engine.diarize(samples);
const detected = [];
for (let index = 0; index < analysis.segments.length; index++) {
  const a = analysis.segments[index];
  for (const b of analysis.segments.slice(index + 1)) {
    if (a.speakerId === b.speakerId) continue;
    const start = Math.max(a.startMs, b.startMs, startMs);
    const end = Math.min(a.endMs, b.endMs, endMs);
    if (end > start) detected.push({ start, end });
  }
}
detected.sort((a, b) => a.start - b.start);
let detectedMs = 0,
  lastEnd = startMs;
for (const range of detected) {
  detectedMs += Math.max(0, range.end - Math.max(lastEnd, range.start));
  lastEnd = Math.max(lastEnd, range.end);
}
const report = {
  modelRevision: engine.modelRevision,
  sourceFiles: [fileA, fileB],
  license: heldout.dataset.license,
  attribution: heldout.dataset.attribution,
  methodology:
    "Two separate held-out LibriSpeech speakers, then an eight-second arithmetic mixture at 0.45 amplitude each, then separate turns. Interval overlap is measured against the known mixing interval; this is a synthetic overlap stress test, not real classroom accuracy.",
  elapsedMs: Math.round(performance.now() - started),
  durationMs: samples.length / 16,
  overlap: {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    detectedMs,
    recall: detectedMs / (endMs - startMs),
  },
  detectedSpeakerIds: [...new Set(analysis.segments.map((segment) => segment.speakerId))],
  flaggedIntervals: analysis.segments.filter((segment) => segment.overlap),
  automaticIdentityAcceptanceEnabled: false,
};
await writeFile(join(here, "evaluation-overlap.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
