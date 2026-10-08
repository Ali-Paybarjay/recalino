import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  AppError,
  deleteObject,
  errors,
  readOwnedObject,
  writeOwnedObject,
} from "@recalino/core/plt";
import {
  type AudioChunk,
  type AudioPreparer,
  registerProcessingTemporaryObject,
} from "@recalino/core/proc";
import { type AudioVerifier, detectBinaryMime } from "@recalino/core/src";
import ffmpegPath from "ffmpeg-static";
import {
  VOICE_CHECK_GAP_MS,
  VOICE_CHECK_MAX_MS,
  type VoiceSourceWindow,
  type VoiceWindowMap,
} from "./voice-source-windows";

// These files are created during invocation; keep the build tracer out of the host temp directory.
const runtimeTemporaryDirectory = tmpdir.bind(undefined);

/** No user-controlled path, URL, shell argument or executable enters the native decoder. */
async function ffmpeg(
  args: string[],
  timeoutMs = 180000,
  binaryOutput = false,
): Promise<{ progress: string; info: string; outputBytes: number }> {
  const executable = ffmpegPath;
  if (!executable)
    throw new AppError("internal", { details: { reason: "audio_decoder_unavailable" } });
  return new Promise((accept, reject) => {
    const child = spawn(
      executable,
      ["-nostdin", "-hide_banner", "-nostats", "-protocol_whitelist", "file,pipe", ...args],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let progress = "";
    let info = "";
    let timedOut = false;
    let outputBytes = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      outputBytes += data.length;
      if (!binaryOutput) progress = (progress + data.toString()).slice(-65536);
    });
    child.stderr.on("data", (data) => {
      info = (info + data.toString()).slice(-65536);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new AppError("internal", { details: { reason: "audio_decoder_unavailable" } }));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Host failures say nothing about the uploaded bytes. Keep the upload pending so
      // the worker can retry instead of permanently rejecting a valid original.
      if (timedOut)
        reject(new AppError("internal", { details: { reason: "audio_decoder_timeout" } }));
      else if (signal || code === null)
        reject(new AppError("internal", { details: { reason: "audio_decoder_interrupted" } }));
      else if (code !== 0) reject(errors.unsupportedMedia());
      else accept({ progress, info, outputBytes });
    });
  });
}
async function withAudioFile<T>(
  bytes: Uint8Array,
  effect: (path: string, directory: string) => Promise<T>,
): Promise<T> {
  const base = resolve(runtimeTemporaryDirectory());
  const directory = await mkdtemp(join(base, "recalino-audio-"));
  const absolute = resolve(directory);
  if (!absolute.startsWith(`${base}${sep}recalino-audio-`))
    throw new Error("Invalid audio temporary directory");
  try {
    const path = join(directory, "input.audio");
    await writeFile(path, bytes, { flag: "wx" });
    return await effect(path, directory);
  } finally {
    await rm(absolute, { recursive: true, force: true });
  }
}
export function audioVerifier(): AudioVerifier {
  return {
    async inspect(bytes, mimeType) {
      if (!mimeType.startsWith("audio/") || detectBinaryMime(bytes) !== mimeType)
        throw errors.unsupportedMedia();
      return withAudioFile(bytes, async (path) => {
        // Count decoded PCM samples: progress timestamps can report the beginning of the last
        // frame and undercount duration. Streamed samples are discarded without buffering audio.
        const output = await ffmpeg(
          [
            "-i",
            path,
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "s16le",
            "pipe:1",
          ],
          180000,
          true,
        );
        const durationMs = Math.ceil(output.outputBytes / 32);
        return {
          durationMs,
          audioOnly: !/Stream #[^\r\n]*Video:/.test(output.info) && durationMs > 0,
        };
      });
    },
  };
}
/** PCM exists only during this invocation; class confirmation playback stays on the device. */
export async function decodeVoiceAudio(
  bytes: Uint8Array,
  maxDurationMs: number,
): Promise<{
  samples: Float32Array;
  sampleRate: 16000;
  durationMs: number;
}> {
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0)
    throw errors.validationFailed({ audio: ["invalid_duration"] });
  return withAudioFile(bytes, async (path, directory) => {
    const outputPath = join(directory, "voice.pcm");
    await ffmpeg(
      [
        "-i",
        path,
        "-t",
        String((maxDurationMs + 1000) / 1000),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "-y",
        outputPath,
      ],
      120000,
    );
    const pcm = await readFile(outputPath);
    try {
      const durationMs = Math.ceil(pcm.length / 32);
      if (!pcm.length || pcm.length % 2 || durationMs > maxDurationMs)
        throw errors.validationFailed({ audio: ["voice_duration_invalid"] });
      const samples = new Float32Array(pcm.length / 2);
      for (let index = 0; index < samples.length; index++)
        samples[index] = pcm.readInt16LE(index * 2) / 32768;
      return { samples, sampleRate: 16000, durationMs };
    } finally {
      pcm.fill(0);
    }
  });
}

/**
 * Browser recordings stamp each packet with the capture clock rather than its sample count:
 * Chrome's 60 ms Opus packets arrive 51–69 ms apart. A seek by container time therefore yields
 * a few milliseconds more or less than the requested span. Read past the end, then cut the
 * window by decoded samples so the composite never depends on container timestamp precision.
 */
export const VOICE_WINDOW_READ_SLACK_MS = 1000;
/** A turn must last 2.4 s after both 200 ms edge guards; a shorter excerpt cannot yield evidence. */
export const VOICE_WINDOW_MIN_MS = 2400;
/** The native engine refuses a composite with less decoded class audio than this. */
export const VOICE_CHECK_MIN_AUDIO_MS = 2000;
/** Decoded shortfall beyond this is reported as partial coverage rather than hidden. */
const VOICE_WINDOW_PARTIAL_MS = 1000;

export interface VoiceWindowCoverage {
  plannedWindows: number;
  usedWindows: number;
  /** The decoder exited with an error for this window. */
  refusedWindows: number;
  /** Decoded, but too short to hold a turn. */
  shortWindows: number;
  plannedMs: number;
  usedMs: number;
}

/** Decode only bounded selected windows; long classes never allocate whole-recording PCM. */
export async function decodeVoiceAudioWindows(
  bytes: Uint8Array,
  windows: readonly VoiceSourceWindow[],
): Promise<{
  samples: Float32Array;
  sampleRate: 16000;
  windows: VoiceWindowMap[];
  /** True when a planned window was skipped or decoded materially shorter than planned. */
  partial: boolean;
  /** Integer attrition counts only; safe to log (PRD-PRIV-06). */
  coverage: VoiceWindowCoverage;
}> {
  const maximumMs =
    windows.reduce((sum, window) => sum + window.end - window.start, 0) +
    Math.max(0, windows.length - 1) * VOICE_CHECK_GAP_MS;
  if (
    !windows.length ||
    !Number.isSafeInteger(maximumMs) ||
    maximumMs > VOICE_CHECK_MAX_MS ||
    windows.some(
      (window) =>
        !Number.isSafeInteger(window.start) ||
        !Number.isSafeInteger(window.end) ||
        window.start < 0 ||
        window.end <= window.start,
    )
  )
    throw errors.validationFailed({ audio: ["voice_selection_invalid"] });
  return withAudioFile(bytes, async (path, directory) => {
    const samples = new Float32Array(maximumMs * 16);
    const mapped: VoiceWindowMap[] = [];
    let cursor = 0;
    let partial = false;
    const coverage: VoiceWindowCoverage = {
      plannedWindows: windows.length,
      usedWindows: 0,
      refusedWindows: 0,
      shortWindows: 0,
      plannedMs: windows.reduce((sum, window) => sum + window.end - window.start, 0),
      usedMs: 0,
    };
    try {
      for (const [index, window] of windows.entries()) {
        const plannedMs = window.end - window.start;
        const outputPath = join(directory, `voice-window-${index}.pcm`);
        try {
          await ffmpeg(
            [
              // Seek by container time, exactly as the transcript chunks were cut.
              "-ss",
              String(window.start / 1000),
              "-i",
              path,
              "-t",
              String((plannedMs + VOICE_WINDOW_READ_SLACK_MS) / 1000),
              "-map",
              "0:a:0",
              "-vn",
              "-sn",
              "-dn",
              "-ac",
              "1",
              "-ar",
              "16000",
              "-c:a",
              "pcm_s16le",
              "-f",
              "s16le",
              "-y",
              outputPath,
            ],
            120000,
          );
        } catch (failure) {
          // A demuxer can refuse one estimated seek target (e.g. a drifted end). The other
          // windows still carry evidence. Host failures (timeouts, no decoder) stop the check.
          // Any decoder error looks the same here, so the refusals are counted and bounded below.
          if (failure instanceof AppError && failure.code === "unsupported_media") {
            partial = true;
            coverage.refusedWindows += 1;
            continue;
          }
          throw failure;
        }
        const pcm = await readFile(outputPath);
        try {
          // Whole milliseconds keep composite boundaries integral; never exceed the plan.
          const usableMs = Math.min(plannedMs, Math.floor(pcm.length / 32));
          if (usableMs <= 0 || usableMs < Math.min(VOICE_WINDOW_MIN_MS, plannedMs - 100)) {
            partial = true;
            coverage.shortWindows += 1;
            continue;
          }
          if (usableMs < plannedMs - VOICE_WINDOW_PARTIAL_MS) partial = true;
          if (mapped.length) cursor += VOICE_CHECK_GAP_MS * 16;
          const compositeStartMs = cursor / 16;
          const count = usableMs * 16;
          for (let sample = 0; sample < count; sample++)
            samples[cursor + sample] = pcm.readInt16LE(sample * 2) / 32768;
          cursor += count;
          coverage.usedWindows += 1;
          coverage.usedMs += usableMs;
          mapped.push({
            sourceStartMs: window.start,
            compositeStartMs,
            compositeEndMs: cursor / 16,
          });
        } finally {
          pcm.fill(0);
          await rm(outputPath, { force: true });
        }
      }
      // A drifted end costs one window; a decoder refusing most of the selection means the
      // recording itself is damaged, and a check over the remainder would misrepresent it.
      if (coverage.refusedWindows * 2 > coverage.plannedWindows)
        throw errors.validationFailed({ audio: ["voice_audio_windows_refused"] });
      // The native engine needs at least two seconds of decoded audio to run at all. Count the
      // excerpts only: the silent separators between them are not audio from the class.
      if (!mapped.length || coverage.usedMs < VOICE_CHECK_MIN_AUDIO_MS)
        throw errors.validationFailed({ audio: ["voice_audio_unusable"] });
      return {
        samples: samples.subarray(0, cursor),
        sampleRate: 16000,
        windows: mapped,
        partial,
        coverage,
      };
    } catch (error) {
      samples.fill(0);
      throw error;
    }
  });
}
function selectedRanges(ranges: { start: number; end: number }[], durationMs: number) {
  const ordered = (ranges.length ? ranges : [{ start: 0, end: durationMs }])
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start);
  const merged: typeof ordered = [];
  for (const range of ordered) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > durationMs
    )
      throw errors.validationFailed({ audio: ["invalid_selection"] });
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}
/** Temporary extraction artifacts only (D29); source ranges remain in original time coordinates. */
export const prepareAudio: AudioPreparer = async ({ db, store, ctx, runId, source, now }) => {
  if (!source.objectId || !source.durationMs)
    throw errors.validationFailed({ audio: ["verified_original_required"] });
  const bytes = await readOwnedObject(db, store, ctx, source.objectId);
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
    throw errors.validationFailed({ audio: ["integrity_mismatch"] });
  const created: AudioChunk[] = [];
  try {
    return await withAudioFile(bytes, async (path, directory) => {
      for (const range of selectedRanges(source.ranges, source.durationMs ?? 0)) {
        for (let offsetMs = range.start; offsetMs < range.end; offsetMs += 300000) {
          const durationMs = Math.min(300000, range.end - offsetMs);
          const outputPath = join(directory, `part-${created.length}.mp3`);
          await ffmpeg([
            "-ss",
            String(offsetMs / 1000),
            "-i",
            path,
            "-t",
            String(durationMs / 1000),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            "-map_metadata",
            "-1",
            "-y",
            outputPath,
          ]);
          const output = await readFile(outputPath);
          const objectId = await writeOwnedObject(db, store, ctx, {
            module: "src",
            retention: "temporary",
            contentType: "audio/mpeg",
            bytes: output,
            now,
            onRegistered: async (objectId) => {
              await registerProcessingTemporaryObject(db, ctx, runId, objectId, now);
            },
          });
          created.push({
            // A class run can contain several independently recorded audio sources.
            id: `${runId}-${source.sourceId}-${created.length}`,
            sourceId: source.sourceId,
            objectId,
            offsetMs,
            durationMs,
            format: "mp3",
          });
        }
      }
      return created;
    });
  } catch (failure) {
    await Promise.allSettled(
      created.map((chunk) => deleteObject(db, store, ctx, chunk.objectId, now)),
    );
    throw failure;
  }
};
