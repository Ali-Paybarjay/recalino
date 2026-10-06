/** Run: node --conditions=react-server tools/voice/evaluate.mjs
 * Uses only CC-BY-4.0 LibriSpeech held-out read speech, never user recordings.
 */

import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { cosineSimilarity, loadVoiceEngine } from "../../apps/web/src/server/voice-engine.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(await readFile(join(here, "models.manifest.json"), "utf8"));
process.env.VOICE_SEGMENTATION_MODEL_PATH = join(here, "models", manifest.segmentation.path);
process.env.VOICE_EMBEDDING_MODEL_PATH = join(here, "models", manifest.embedding.path);
const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ffmpeg = appRequire("ffmpeg-static");
const dataset = resolve(here, "evaluation-data/LibriSpeech/test-clean");
const speakers = ["1089", "121", "237"];
const longTurns = process.argv.includes("--long-turns");
const outputPath = join(here, longTurns ? "evaluation-long-turns.json" : "evaluation-report.json");
async function flacs(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await flacs(path)));
    else if (entry.name.endsWith(".flac")) result.push(path);
  }
  return result.sort();
}
function decode(path) {
  const result = spawnSync(
    ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30000,
    },
  );
  if (result.status !== 0) throw new Error("evaluation_decode_failed");
  const buffer = result.stdout;
  const data = new Float32Array(buffer.length / 4);
  for (let index = 0; index < data.length; index++) data[index] = buffer.readFloatLE(index * 4);
  return data;
}
const engine = await loadVoiceEngine();
const audio = {};
const enrollment = {};
const sourceFiles = {};
for (const id of speakers) {
  const files = await flacs(join(dataset, id));
  // Reserve utterances 0..2 for enrollment; evaluation utterances never enter the enrollment vector.
  const training = files.slice(0, 3).map(decode);
  const length = Math.min(
    30 * 16000,
    training.reduce((sum, pcm) => sum + pcm.length, 0),
  );
  const sample = new Float32Array(length);
  let offset = 0;
  for (const pcm of training) {
    const take = Math.min(pcm.length, length - offset);
    sample.set(pcm.subarray(0, take), offset);
    offset += take;
    if (offset === length) break;
  }
  enrollment[id] = await engine.embed(sample);
  audio[id] = [];
  for (const file of files.slice(3)) {
    const samples = decode(file);
    if (!longTurns || samples.length >= 8 * 16000) audio[id].push({ file, samples });
    if (audio[id].length === 8) break;
  }
  sourceFiles[id] = {
    enrollment: files.slice(0, 3).map((file) => file.split(/[\\/]/).at(-1)),
    evaluation: audio[id].map(({ file }) => file.split(/[\\/]/).at(-1)),
  };
}
function mix(learner, lesson) {
  const teacher = speakers[(speakers.indexOf(learner) + 1) % speakers.length];
  const classmate = speakers.find((id) => id !== learner && id !== teacher);
  const turns = [];
  const pcm = [];
  let length = 16000;
  pcm.push(new Float32Array(16000));
  // The learner has fewer turns than the teacher, and never starts the recording.
  for (const [id, count] of [
    [teacher, 4],
    [classmate, 2],
    [learner, 2],
    [teacher, 2],
    [learner, 1],
  ]) {
    for (let index = 0; index < count; index++) {
      const samples = audio[id][(index + lesson * 2) % audio[id].length].samples;
      const used = samples.subarray(0, Math.min(samples.length, 12000 * 16));
      turns.push({ id, startMs: length / 16, endMs: (length + used.length) / 16 });
      pcm.push(used, new Float32Array(8000));
      length += used.length + 8000;
    }
  }
  pcm.push(new Float32Array(16000));
  length += 16000;
  const samples = new Float32Array(length);
  let cursor = 0;
  for (const part of pcm) {
    samples.set(part, cursor);
    cursor += part.length;
  }
  return { samples, turns, learner, teacher };
}
function labelledSpeaker(segments, speakerId, truth) {
  const durations = {};
  for (const segment of segments.filter((segment) => segment.speakerId === speakerId))
    for (const turn of truth)
      durations[turn.id] =
        (durations[turn.id] ?? 0) +
        Math.max(0, Math.min(segment.endMs, turn.endMs) - Math.max(segment.startMs, turn.startMs));
  return Object.entries(durations).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const recordings = [];
for (let lesson = 0; lesson < speakers.length; lesson++) {
  const fixture = mix(speakers[lesson], lesson);
  const start = performance.now();
  const result = await engine.diarize(fixture.samples);
  const elapsedMs = performance.now() - start;
  const candidates = result.speakers
    .map((speaker) => ({
      speakerId: speaker.speakerId,
      knownSpeaker: labelledSpeaker(result.segments, speaker.speakerId, fixture.turns),
      cleanSpeechMs: speaker.cleanSpeechMs,
      score: cosineSimilarity(speaker.embedding, enrollment[fixture.learner]),
    }))
    .sort((a, b) => b.score - a.score);
  const report = {
    fixture: `synthetic-librispeech-${longTurns ? "long" : "short"}-${lesson + 1}`,
    learner: fixture.learner,
    teacher: fixture.teacher,
    durationMs: fixture.samples.length / 16,
    elapsedMs: Math.round(elapsedMs),
    realTimeFactor: elapsedMs / (fixture.samples.length / 16),
    diarizedSpeakers: result.speakers.length,
    candidates,
    firstCandidateCorrect: candidates[0]?.knownSpeaker === fixture.learner,
    margin: candidates.length > 1 ? candidates[0].score - candidates[1].score : null,
    overlapFlaggedSegments: result.segments.filter((segment) => segment.overlap).length,
  };
  recordings.push(report);
  console.log(JSON.stringify(report));
}
const report = {
  modelRevision: engine.modelRevision,
  generatedAt: new Date().toISOString(),
  machine: {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCores: cpus().length,
    inferenceThreads: 2,
  },
  dataset: {
    name: "LibriSpeech test-clean",
    url: "https://www.openslr.org/12/",
    license: "CC-BY-4.0",
    attribution: "LibriSpeech (c) 2014 Vassil Panayotov",
    sourceFiles,
  },
  methodology:
    "Three deterministic concatenations of held-out utterances from three known speakers. The learner is not the dominant speaker. Enrollment uses separate utterances from the same speakers. Real ONNX inference, no mocked vectors. These are clean read-speech simulations, not classroom recordings and not threshold calibration.",
  autoAcceptanceEnabled: false,
  realClassroomRecordingsTested: 0,
  recordings,
  correctFirstCandidates: recordings.filter((item) => item.firstCandidateCorrect).length,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    report: outputPath,
    correct: report.correctFirstCandidates,
    recordings: recordings.length,
  }),
);
