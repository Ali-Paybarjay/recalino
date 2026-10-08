import "server-only";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { withTransaction } from "@recalino/core/db";
import {
  confirmObject,
  createObject,
  deleteObject,
  enqueueJob,
  errors,
  issueReadLink,
  issueWriteLink,
  readPltSettings,
  spikeCleanup,
  spikeJobReport,
  spikeObjects,
} from "@recalino/core/plt";
import { VercelBlobStore } from "@recalino/core/plt/vercel-blob";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";
import type { Handler } from "./api";
import { runJobsSoon } from "./jobs";
import { spikeJobDefinitions } from "./spike-jobs";
import { checkVoiceRuntime } from "./voice-engine";

// SPIKE-05 only (M4, T3 to T5): measurements on the protected cloud deployment. Answers 404
// unless RECALINO_SPIKE=1 and the caller sends SPIKE_TOKEN. Synthetic data only. Removed in T6.

const store = new VercelBlobStore();
const ms = (start: number) => Math.round(performance.now() - start);

function guard(request: Request): void {
  const token = process.env.SPIKE_TOKEN ?? "";
  const given = request.headers.get("x-spike-token") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  // A staged release can prove its packaged native runtime without changing the operator token.
  // This short-lived credential authorizes only internal synthetic inference, never another spike.
  const releaseToken = process.env.VOICE_RELEASE_CHECK_TOKEN ?? "";
  const expiresAt = Date.parse(process.env.VOICE_RELEASE_CHECK_EXPIRES_AT ?? "");
  const now = Date.now();
  if (
    new URL(request.url).pathname.split("/").at(-1) === "voice-runtime" &&
    releaseToken.length >= 32 &&
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    expiresAt - now <= 6 * 60 * 60 * 1000 &&
    timingSafeEqual(digest(given), digest(releaseToken))
  )
    return;
  if (
    process.env.RECALINO_SPIKE !== "1" ||
    token.length < 32 ||
    !timingSafeEqual(digest(given), digest(token))
  ) {
    throw errors.notFound();
  }
}

const idList = z.array(z.uuid()).min(1).max(100);

async function objectKeys(db: Parameters<Handler>[0]["db"], ids: string[]) {
  const rows = await spikeObjects(db, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw errors.notFound();
    return row;
  });
}

/** Peak resident memory of this process and of a child, sampled every 200 ms (Linux /proc). */
function memorySampler(childPid?: number) {
  let selfPeak = 0;
  let childPeak = 0;
  const sample = async () => {
    selfPeak = Math.max(selfPeak, process.memoryUsage().rss);
    if (childPid === undefined) return;
    try {
      const status = await readFile(`/proc/${childPid}/status`, "utf8");
      const kb = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0);
      childPeak = Math.max(childPeak, kb * 1024);
    } catch {
      // The child has exited.
    }
  };
  const timer = setInterval(() => void sample(), 200);
  return {
    stop: async () => {
      await sample();
      clearInterval(timer);
      return { selfMb: Math.round(selfPeak / 2 ** 20), childMb: Math.round(childPeak / 2 ** 20) };
    },
  };
}

function runFfmpeg(args: string[]): Promise<{ ms: number; stderr: string; memory: unknown }> {
  if (!ffmpegPath) throw new Error("no ffmpeg binary");
  const started = performance.now();
  const child = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args]);
  const sampler = memorySampler(child.pid);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-200_000);
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", async (code) => {
      const memory = await sampler.stop();
      if (code === 0) resolve({ ms: ms(started), stderr, memory });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) total += (await stat(join(dir, name))).size;
  return total;
}

export function spikeHandler(): Handler {
  return async ({ request, input, db }) => {
    guard(request);
    const action = new URL(request.url).pathname.split("/").at(-1);
    const body = (input ?? {}) as Record<string, unknown>;
    if (action === "voice-runtime") {
      z.strictObject({}).parse(body);
      const result = await checkVoiceRuntime();
      return {
        body: { passed: true, modelRevision: result.modelRevision, elapsedMs: result.durationMs },
      };
    }
    const settings = readPltSettings();
    const now = new Date();

    switch (action) {
      case "queue-burst": {
        const count = z.int().min(1).max(50).parse(body.count);
        const [echo] = spikeJobDefinitions().filter((def) => def.kind === "spike.echo");
        if (!echo) throw errors.notFound();
        const ids: string[] = [];
        const timings: number[] = [];
        for (let i = 0; i < count; i += 1) {
          const started = performance.now();
          const id = await withTransaction(db, (tx) =>
            enqueueJob(tx, echo, {
              payload: { tag: `burst-${i}` },
              now: new Date(),
              defaults: settings.jobs,
            }),
          );
          timings.push(ms(started));
          if (id) ids.push(id);
        }
        runJobsSoon(["spike.echo"], 120);
        return { body: { ids, enqueueMs: timings } };
      }
      case "queue-crash": {
        const [crash] = spikeJobDefinitions().filter((def) => def.kind === "spike.crash");
        if (!crash) throw errors.notFound();
        const id = await withTransaction(db, (tx) =>
          enqueueJob(tx, crash, { payload: { tag: "crash" }, now, defaults: settings.jobs }),
        );
        runJobsSoon(["spike.crash"], 60);
        return { body: { id, enqueuedAt: now } };
      }
      case "queue-status": {
        return { body: await spikeJobReport(db, idList.parse(body.ids)) };
      }
      case "blob-put-link": {
        const contentType = z
          .string()
          .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
          .parse(body.contentType);
        const size = z.int().positive().parse(body.size);
        const seconds = z
          .int()
          .min(1)
          .max(3600)
          .parse(body.seconds ?? 300);
        const started = performance.now();
        const object = await createObject(db, {
          module: "spike",
          ownerUserId: null,
          retention: "temporary",
          contentType,
          sizeBytes: size,
          now,
        });
        const link = await issueWriteLink(db, store, "system", object.id, {
          now,
          settings: { ...settings.storage, writeLinkSeconds: seconds },
        });
        return {
          body: { id: object.id, url: link.url, validUntil: link.validUntil, ms: ms(started) },
        };
      }
      case "blob-confirm": {
        const id = z.uuid().parse(body.id);
        const sha256 = z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional()
          .parse(body.sha256);
        const started = performance.now();
        const result = await confirmObject(db, store, "system", id, { now, sha256 });
        return { body: { result, ms: ms(started) } };
      }
      case "blob-head": {
        const [object] = await objectKeys(db, [z.uuid().parse(body.id)]);
        const started = performance.now();
        const info = object ? await store.head(object.key) : null;
        return { body: { info, ms: ms(started) } };
      }
      case "blob-get-link": {
        const id = z.uuid().parse(body.id);
        const seconds = z
          .int()
          .min(1)
          .max(3600)
          .parse(body.seconds ?? 300);
        const link = await issueReadLink(db, store, "system", id, {
          now,
          settings: settings.storage,
          validForSeconds: seconds,
        });
        return { body: link };
      }
      case "blob-delete": {
        const id = z.uuid().parse(body.id);
        const started = performance.now();
        await deleteObject(db, store, "system", id, now);
        return { body: { deletedAt: new Date(), ms: ms(started) } };
      }
      case "blob-compose": {
        const parts = await objectKeys(db, idList.parse(body.ids));
        const method = z.enum(["stream", "multipart"]).parse(body.method);
        const total = parts.reduce((sum, part) => sum + part.size, 0);
        const type = parts[0]?.type ?? "application/octet-stream";
        const target = await createObject(db, {
          module: "spike",
          ownerUserId: null,
          retention: "temporary",
          contentType: type,
          sizeBytes: total,
          now,
        });
        const sampler = memorySampler();
        const started = performance.now();
        await store.compose(
          parts.map((part) => part.key),
          target.key,
          type,
          method,
        );
        const composeMs = ms(started);
        const memory = await sampler.stop();
        const result = await confirmObject(db, store, "system", target.id, { now: new Date() });
        return { body: { targetId: target.id, totalBytes: total, composeMs, memory, result } };
      }
      case "ffmpeg": {
        const id = z.uuid().parse(body.id);
        const dir = await mkdtemp(join(tmpdir(), "spike-"));
        try {
          const link = await issueReadLink(db, store, "system", id, {
            now,
            settings: settings.storage,
            validForSeconds: 900,
          });
          const started = performance.now();
          const response = await fetch(link.url);
          if (!response.ok || !response.body) throw new Error(`download ${response.status}`);
          const input = join(dir, "input");
          await pipeline(
            Readable.fromWeb(response.body as WebReadableStream),
            createWriteStream(input),
          );
          const downloadMs = ms(started);
          const inputBytes = (await stat(input)).size;

          const normalized = join(dir, "normalized.ogg");
          const normalize = await runFfmpeg([
            "-i",
            input,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libopus",
            "-b:a",
            "24k",
            normalized,
          ]);
          const silence = await runFfmpeg([
            "-i",
            normalized,
            "-af",
            "silencedetect=noise=-35dB:d=2",
            "-f",
            "null",
            "-",
          ]);
          // Cut at the first silence after every 10 minutes (PRD-SEG-03: split at pauses).
          const ends = [...silence.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
            Number(m[1]),
          );
          const cuts: number[] = [];
          for (const end of ends) {
            if (end - (cuts.at(-1) ?? 0) >= 600) cuts.push(end);
          }
          const segment = await runFfmpeg([
            "-i",
            normalized,
            "-f",
            "segment",
            "-segment_times",
            cuts.join(",") || "600",
            "-c",
            "copy",
            join(dir, "part-%03d.ogg"),
          ]);
          const parts = (await readdir(dir)).filter((name) => name.startsWith("part-")).length;
          return {
            body: {
              ffmpeg: ffmpegPath,
              inputBytes,
              downloadMs,
              normalize: { ms: normalize.ms, memory: normalize.memory },
              silenceDetect: { ms: silence.ms, memory: silence.memory, silences: ends.length },
              segment: { ms: segment.ms, memory: segment.memory, parts },
              tmpBytes: await dirBytes(dir),
              totalMs: ms(started),
            },
          };
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      case "cleanup": {
        return { body: await spikeCleanup(db, store, now) };
      }
      default:
        throw errors.notFound();
    }
  };
}
