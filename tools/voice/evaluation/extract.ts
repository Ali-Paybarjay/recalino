/**
 * Runs the production voice code on AMI meetings and caches what the policy needs.
 *
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/extract.ts --split calibration
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/extract.ts --split holdout
 *
 * Enrolment samples pass through prepareVoiceSample and class recordings through
 * diarizeVoiceRecording and buildVoiceAnalysis, exactly as in the app. No network call, AI
 * provider or database is used. Outputs (including speaker vectors of AMI participants) stay
 * in the Git-ignored evaluation-data directory; only aggregate reports are committed.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { audioVerifier } from "../../../apps/web/src/server/audio-preparer.ts";
import {
  loadVoiceEngine,
  VOICE_SPAN_MODE,
  type VoiceSpanMode,
} from "../../../apps/web/src/server/voice-engine.ts";
import { embeddingSpans } from "../../../apps/web/src/server/voice-engine-quality.mjs";
import { diarizeVoiceRecording } from "../../../apps/web/src/server/voice-processing.ts";
import { prepareVoiceSample } from "../../../apps/web/src/server/voice-sample.ts";
import {
  type VoiceWindowPlan,
  voiceSourceWindows,
} from "../../../apps/web/src/server/voice-source-windows.ts";
import { AppError } from "../../../packages/core/src/plt/index.ts";
import type { RunSource } from "../../../packages/core/src/proc/contracts.ts";
import {
  buildVoiceAnalysis,
  scopedVoiceSpeakerId,
} from "../../../packages/core/src/proc/voice-processing.ts";
import {
  AMI_AUDIO,
  AMI_DERIVED,
  AMI_FEATURES,
  type AmiGroup,
  type AmiSegment,
  amiParticipants,
  amiSegments,
  annotatedOverlap,
  audioFile,
  type Condition,
  groupsOf,
  type Split,
} from "./ami.ts";
import { pipelineSettings } from "./freeze.ts";
import type { ClassFeature, EnrollmentFeature } from "./simulate.ts";

const appRequire = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const ffmpeg: string = appRequire("ffmpeg-static");

/** Pre-registered enrolment construction (PROTOCOL.md §3). */
export const ENROLMENT = {
  minPieceMs: 3000,
  isolationMs: 300,
  targetSpeechMs: 28000,
  minSpeechMs: 16000,
  leadInMs: 800,
  gapMs: 600,
  bitrate: "32k",
} as const;
export const OPUS_CLASS_BITRATE = "24k";

function run(args: string[]) {
  const result = spawnSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], {
    maxBuffer: 1024 * 1024 * 1024,
    timeout: 600000,
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr).slice(0, 300)}`);
  return result.stdout;
}

/** 16 kHz mono 16-bit PCM from an AMI WAV file, located through its RIFF chunks. */
async function readWav(path: string): Promise<Int16Array> {
  const bytes = await readFile(path);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`not a WAV file: ${path}`);
  let offset = 12;
  let format: { channels: number; rate: number; bits: number } | undefined;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ")
      format = {
        channels: bytes.readUInt16LE(offset + 10),
        rate: bytes.readUInt32LE(offset + 12),
        bits: bytes.readUInt16LE(offset + 22),
      };
    if (id === "data") {
      if (format?.channels !== 1 || format.rate !== 16000 || format.bits !== 16)
        throw new Error(`unexpected WAV format: ${path}`);
      const data = bytes.subarray(offset + 8, offset + 8 + size);
      return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`WAV data chunk missing: ${path}`);
}

async function encodeOpus(pcm: Int16Array, bitrate: string): Promise<Uint8Array> {
  const directory = join(tmpdir(), `recalino-eval-${randomUUID()}`);
  await mkdir(directory);
  try {
    const input = join(directory, "in.raw"),
      output = join(directory, "out.webm");
    await writeFile(input, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    run(["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", input, ...opusArgs(bitrate), output]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function opusArgs(bitrate: string) {
  return ["-c:a", "libopus", "-b:a", bitrate, "-ac", "1", "-ar", "48000", "-application", "voip"];
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) {
    const fields = (error.details as { fields?: Record<string, unknown> } | undefined)?.fields;
    for (const value of Object.values(fields ?? {}))
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return error.code;
  }
  return error instanceof Error && /^voice_[a-z0-9_]+$/.test(error.message)
    ? error.message
    : "unexpected";
}

/**
 * Speech of one participant in session a with every other participant's annotated speech
 * (plus a 300 ms guard) cut out; the longest clean pieces first, then in time order.
 */
export function enrolmentPieces(segments: readonly AmiSegment[], participant: string) {
  const others = segments.filter((segment) => segment.participant !== participant);
  const clean: { startMs: number; endMs: number }[] = [];
  for (const segment of segments) {
    if (segment.participant !== participant) continue;
    let pieces = [{ startMs: segment.startMs, endMs: segment.endMs }];
    for (const other of others) {
      const cutStart = other.startMs - ENROLMENT.isolationMs,
        cutEnd = other.endMs + ENROLMENT.isolationMs;
      pieces = pieces.flatMap((piece) =>
        cutEnd <= piece.startMs || cutStart >= piece.endMs
          ? [piece]
          : [
              { startMs: piece.startMs, endMs: Math.min(piece.endMs, cutStart) },
              { startMs: Math.max(piece.startMs, cutEnd), endMs: piece.endMs },
            ].filter((part) => part.endMs > part.startMs),
      );
    }
    clean.push(...pieces.filter((piece) => piece.endMs - piece.startMs >= ENROLMENT.minPieceMs));
  }
  const chosen: { startMs: number; endMs: number }[] = [];
  let speechMs = 0;
  for (const piece of clean.sort(
    (a, b) => b.endMs - b.startMs - (a.endMs - a.startMs) || a.startMs - b.startMs,
  )) {
    const take = Math.min(piece.endMs - piece.startMs, ENROLMENT.targetSpeechMs - speechMs);
    if (take < ENROLMENT.minPieceMs) break;
    chosen.push({ startMs: piece.startMs, endMs: piece.startMs + take });
    speechMs += take;
  }
  return { pieces: chosen.sort((a, b) => a.startMs - b.startMs), speechMs };
}

async function enrol(engine: Awaited<ReturnType<typeof loadVoiceEngine>>, group: AmiGroup) {
  const meeting = `${group}a`;
  const segments = amiSegments(meeting);
  let pcm: Int16Array | undefined;
  for (const participant of amiParticipants(meeting).values()) {
    const path = join(AMI_FEATURES, `enrol.${group}.${participant}.json`);
    if (existsSync(path)) continue;
    pcm ??= await readWav(join(AMI_AUDIO, `${meeting}.Mix-Headset.wav`));
    const { pieces, speechMs } = enrolmentPieces(segments, participant);
    const feature: EnrollmentFeature = {
      pipeline: pipelineSettings(),
      group,
      participant,
      speechMs,
      pieces: pieces.length,
      bytes: 0,
      embedding: null,
      failure: null,
      modelRevision: null,
    };
    if (speechMs < ENROLMENT.minSpeechMs) feature.failure = "eval_insufficient_isolated_speech";
    else {
      // A short lead-in like a real recording; no trailing silence, as after an automatic stop.
      const gap = ENROLMENT.gapMs * 16,
        lead = ENROLMENT.leadInMs * 16;
      const total = pieces.reduce((sum, piece) => sum + (piece.endMs - piece.startMs) * 16, 0);
      const sample = new Int16Array(lead + total + gap * (pieces.length - 1));
      let cursor = lead;
      for (const [index, piece] of pieces.entries()) {
        if (index) cursor += gap;
        const slice = pcm.subarray(piece.startMs * 16, piece.endMs * 16);
        sample.set(slice, cursor);
        cursor += slice.length;
      }
      const bytes = await encodeOpus(sample, ENROLMENT.bitrate);
      feature.bytes = bytes.byteLength;
      try {
        const prepared = await prepareVoiceSample(() => Promise.resolve(engine), bytes);
        feature.embedding = prepared.embedding;
        feature.modelRevision = prepared.modelRevision;
      } catch (error) {
        feature.failure = failureCode(error);
      }
    }
    await writeFile(path, JSON.stringify(feature));
    console.log(`enrol ${group} ${participant} ${feature.failure ?? "ok"}`);
  }
}

function transcriptSource(meeting: string, durationMs: number, segments: readonly AmiSegment[]) {
  const sourceId = randomUUID();
  // Speaker-aligned manual segments stand in for STT segments (optimistic for clip counts).
  const kept = segments.filter((segment) => segment.endMs <= durationMs);
  const source: RunSource = {
    sourceId,
    kind: "audio",
    sha256: createHash("sha256").update(meeting).digest("hex"),
    mimeType: "audio/wav",
    durationMs,
    pageCount: null,
    objectId: null,
    contentVersionId: null,
    captureAnchor: null,
    ranges: [],
    units: kept.map((segment, index) => ({
      id: `u${index}`,
      kind: "time" as const,
      start: segment.startMs,
      end: segment.endMs,
      status: "extracted" as const,
    })),
    blocks: kept.map((_segment, index) => ({
      id: `b${index}`,
      kind: "transcript" as const,
      text: "AMI segment",
      unitId: `u${index}`,
      timeStatus: "exact" as const,
    })),
  };
  return source;
}

async function extractClass(
  engine: Awaited<ReturnType<typeof loadVoiceEngine>>,
  meeting: string,
  condition: Condition,
) {
  const path = join(AMI_FEATURES, `class.${meeting}.${condition}.json`);
  if (existsSync(path)) return;
  const feature = await measureClass(engine, meeting, condition);
  await writeFile(path, JSON.stringify(feature));
  console.log(
    `class ${meeting} ${condition} ${feature.failure ?? `${feature.candidates.length} voices`} ${feature.timing.wallMs} ms`,
  );
}

/** One production class check of an AMI meeting, with ground-truth shares per detected voice. */
export async function measureClass(
  engine: Awaited<ReturnType<typeof loadVoiceEngine>>,
  meeting: string,
  condition: Condition,
  plan?: VoiceWindowPlan,
  spanMode: VoiceSpanMode = VOICE_SPAN_MODE,
): Promise<ClassFeature> {
  if (condition === "opus" && !existsSync(audioFile(meeting, "opus"))) {
    await mkdir(AMI_DERIVED, { recursive: true });
    run([
      "-i",
      audioFile(meeting, "headset"),
      ...opusArgs(OPUS_CLASS_BITRATE),
      audioFile(meeting, "opus"),
    ]);
  }
  const bytes = new Uint8Array(await readFile(audioFile(meeting, condition)));
  const mimeType = condition === "opus" ? "audio/webm" : "audio/wav";
  const { durationMs } = await audioVerifier().inspect(bytes, mimeType);
  const segments = amiSegments(meeting);
  const source = transcriptSource(meeting, durationMs, segments);
  const cpu = process.cpuUsage();
  const started = performance.now();
  let feature: ClassFeature;
  try {
    const diarization = await diarizeVoiceRecording(engine, bytes, durationMs, [], plan);
    const wallMs = performance.now() - started;
    const used = process.cpuUsage(cpu);
    const analysis = buildVoiceAnalysis(
      {
        sessionId: randomUUID(),
        sourceId: source.sourceId,
        sourceVersionId: randomUUID(),
        runId: randomUUID(),
        profileVersion: 1,
      },
      source,
      diarization,
      "en",
    );
    const labels = [...new Set(diarization.segments.map((segment) => segment.speakerId))];
    const windows = voiceSourceWindows(durationMs, [], plan).windows.map((window) => ({
      startMs: window.start,
      endMs: window.end,
    }));
    feature = {
      pipeline: pipelineSettings(),
      meeting,
      condition,
      durationMs,
      failure: null,
      sampled: Boolean(diarization.sampled),
      partial: Boolean(diarization.partial),
      modelRevision: diarization.modelRevision,
      timing: {
        wallMs: Math.round(wallMs),
        cpuUserMs: Math.round(used.user / 1000),
        cpuSystemMs: Math.round(used.system / 1000),
        maxRssKb: process.resourceUsage().maxRSS,
        compositeMs: diarization.coverage?.usedMs ?? null,
      },
      windowSpeechMs: Object.fromEntries(annotatedOverlap(segments, windows)),
      candidates: analysis.candidates.map((candidate) => {
        const label =
          labels.find(
            (item) => scopedVoiceSpeakerId(source.sourceId, "whole-source", item) === candidate.id,
          ) ?? "";
        const speaker = diarization.speakers.find((item) => item.speakerId === label);
        const spans = embeddingSpans(diarization.segments, label, spanMode);
        const spanMs = spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
        // Identity follows the speech that formed the vector; without one, all of its turns.
        const basis = spans.length
          ? spans
          : diarization.segments.filter((segment) => segment.speakerId === label);
        const shares = annotatedOverlap(segments, basis);
        return {
          id: candidate.id,
          cleanSpeechMs: candidate.cleanSpeechMs,
          clips: candidate.clips.length,
          vector:
            analysis.embeddings.find((item) => item.speakerId === candidate.id)?.vector ?? null,
          shares: Object.fromEntries(shares),
          basisMs: basis.reduce((sum, span) => sum + span.endMs - span.startMs, 0),
          spanMs,
          spanCheck: spans.length ? spanMs === Math.round(speaker?.cleanSpeechMs ?? -1) : null,
        };
      }),
    };
  } catch (error) {
    feature = {
      pipeline: pipelineSettings(),
      meeting,
      condition,
      durationMs,
      failure: failureCode(error),
      sampled: false,
      partial: false,
      modelRevision: engine.modelRevision,
      timing: {
        wallMs: Math.round(performance.now() - started),
        cpuUserMs: 0,
        cpuSystemMs: 0,
        maxRssKb: process.resourceUsage().maxRSS,
        compositeMs: null,
      },
      windowSpeechMs: {},
      candidates: [],
    };
  } finally {
    bytes.fill(0);
  }
  return feature;
}

async function main() {
  const argument = (name: string) => {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : undefined;
  };
  const split = argument("--split") as Split | undefined;
  const only = argument("--only");
  if (split !== "calibration" && split !== "holdout")
    throw new Error("--split calibration|holdout");
  await mkdir(AMI_FEATURES, { recursive: true });
  const engine = await loadVoiceEngine();
  for (const group of groupsOf(split)) {
    if (only && group !== only) continue;
    await enrol(engine, group);
    await extractClass(engine, `${group}b`, "headset");
    for (const session of ["c", "d"])
      for (const condition of ["headset", "farfield", "opus"] as const)
        await extractClass(engine, `${group}${session}`, condition);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
