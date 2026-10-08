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

/** Decode only bounded selected windows; long classes never allocate whole-recording PCM. */
export async function decodeVoiceAudioWindows(
  bytes: Uint8Array,
  windows: readonly VoiceSourceWindow[],
): Promise<{ samples: Float32Array; sampleRate: 16000; windows: VoiceWindowMap[] }> {
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
    try {
      for (const [index, window] of windows.entries()) {
        const outputPath = join(directory, `voice-window-${index}.pcm`);
        await ffmpeg(
          [
            "-ss",
            String(window.start / 1000),
            "-i",
            path,
            "-t",
            String((window.end - window.start) / 1000),
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
          if (
            !pcm.length ||
            pcm.length % 2 ||
            durationMs > window.end - window.start ||
            durationMs < window.end - window.start - 100
          )
            throw errors.validationFailed({ audio: ["voice_duration_invalid"] });
          const compositeStartMs = cursor / 16;
          for (let sample = 0; sample < pcm.length / 2; sample++)
            samples[cursor + sample] = pcm.readInt16LE(sample * 2) / 32768;
          cursor += durationMs * 16;
          mapped.push({
            sourceStartMs: window.start,
            compositeStartMs,
            compositeEndMs: cursor / 16,
          });
          if (index < windows.length - 1) cursor += VOICE_CHECK_GAP_MS * 16;
        } finally {
          pcm.fill(0);
        }
      }
      return { samples: samples.subarray(0, cursor), sampleRate: 16000, windows: mapped };
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
