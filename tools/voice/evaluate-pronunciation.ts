/** Explicit paid evaluation: pnpm exec tsx tools/voice/evaluate-pronunciation.ts --live --asr
 * Delayed billing refresh (read-only): use --refresh-costs without --live.
 * Synthetic phrases only; credentials are read locally, DB destinations must be loopback.
 * Media cache/queue/accounting use the real domain path with an in-memory private store.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { OpenRouterProvider, providerSettingsSchema } from "../../packages/core/src/aip";
import { createDatabase } from "../../packages/core/src/db";
import {
  getMediaAsset,
  type MediaDependencies,
  mediaSettingsSchema,
  mediaTtsJob,
  readMediaBytes,
  requestTts,
} from "../../packages/core/src/media";
import { MemoryObjectStore, runDueJobs } from "../../packages/core/src/plt";
import {
  completeAuxiliaryRun,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  scheduleAuxiliaryRun,
} from "../../packages/core/src/proc";
import { allowance, amounts, grantEntitlement } from "../../packages/core/src/quota";
import {
  LOCAL_ADMIN_DATABASE_URL,
  LOCAL_APP_DATABASE_URL,
} from "../../packages/core/test/local-db";
import {
  cleanupSyntheticPronunciationFixture,
  readSyntheticPronunciationCosts,
} from "../../packages/core/test/pronunciation-evaluation-fixture";
import { studyFixture } from "../../packages/core/test/study-fixture";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "artifacts/verification/d46-live-pronunciation");
const targets = ["wear and tear", "kit it out", "a hefty discount"];
const sampleRate = 16000;
const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
function assertLocal(value: string) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname))
    throw new Error("non_local_database_rejected");
}
function decode(ffmpeg: string, path: string): Buffer {
  const decoded = spawnSync(
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
      String(sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    },
  );
  if (decoded.status !== 0 || !decoded.stdout.length) throw new Error("audio_decode_failed");
  return decoded.stdout;
}
function integrity(pcm: Buffer) {
  let peak = 0,
    squares = 0,
    clippedSamples = 0;
  const samples = pcm.length / 4;
  for (let index = 0; index < samples; index++) {
    const value = pcm.readFloatLE(index * 4);
    if (!Number.isFinite(value)) throw new Error("audio_non_finite");
    peak = Math.max(peak, Math.abs(value));
    squares += value * value;
    if (Math.abs(value) >= 0.999) clippedSamples++;
  }
  return {
    durationSeconds: samples / sampleRate,
    peak,
    rms: Math.sqrt(squares / samples),
    clippedSamples,
    samples,
  };
}
async function generationCost(key: string, id: string | null) {
  if (!id) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.ok) {
      const value = (await response.json()) as {
        data?: { total_cost?: number; model?: string; provider_name?: string };
      };
      if (typeof value.data?.total_cost === "number")
        return {
          usd: value.data.total_cost,
          model: value.data.model,
          provider: value.data.provider_name,
          source: "OpenRouter generation.total_cost",
        };
    }
    if (attempt < 3) await sleep(750);
  }
  return null;
}
async function refreshCosts(key: string, report: Record<string, unknown>) {
  const clips = report.observations as Array<{
    generationId: string;
    cost: Awaited<ReturnType<typeof generationCost>>;
  }>;
  const asr = report.asr as
    | { generationId: string; cost: Awaited<ReturnType<typeof generationCost>> }
    | undefined;
  if (report.syntheticOnly !== true || !Array.isArray(clips))
    throw new Error("invalid_evaluation_report");
  for (const clip of clips) clip.cost = await generationCost(key, clip.generationId);
  if (asr) asr.cost = await generationCost(key, asr.generationId);
  const complete = clips.every((clip) => clip.cost !== null) && (!asr || asr.cost !== null);
  const ttsUsd = clips.every((clip) => clip.cost !== null)
    ? Number(clips.reduce((sum, clip) => sum + (clip.cost?.usd ?? 0), 0).toFixed(12))
    : null;
  report.costSummary = {
    source: "OpenRouter generation.total_cost (read-only)",
    complete,
    ttsUsd,
    asrUsd: asr ? (asr.cost?.usd ?? null) : 0,
    totalUsd: complete ? Number(((ttsUsd ?? 0) + (asr?.cost?.usd ?? 0)).toFixed(12)) : null,
    cacheReplaySpeechCalls: 0,
    cacheReplayTtsCostUsd: 0,
    limitation:
      "Local media cost ledger uses the configured bound when speech response omits actual cost; this report uses delayed provider billing records.",
  };
}
async function main() {
  if (process.argv.includes("--refresh-costs")) {
    loadEnvFile(resolve(root, "apps/web/.env.local"));
    const key = process.env.OPENROUTER_API_KEY;
    if (!key?.trim()) throw new Error("provider_key_missing");
    const report = JSON.parse(await readFile(resolve(output, "report.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await refreshCosts(key, report);
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.costSummary, null, 2));
    return;
  }
  if (!process.argv.includes("--live")) {
    console.log(
      "Explicit --live is required for three paid synthetic TTS calls; --asr adds one combined Whisper check.",
    );
    return;
  }
  assertLocal(LOCAL_APP_DATABASE_URL);
  assertLocal(LOCAL_ADMIN_DATABASE_URL);
  loadEnvFile(resolve(root, "apps/web/.env.local"));
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) throw new Error("provider_key_missing");
  const settings = providerSettingsSchema.parse(
    JSON.parse(await readFile(resolve(root, "config/openrouter-defaults.json"), "utf8")),
  );
  const mediaSettings = mediaSettingsSchema.parse(
    JSON.parse(await readFile(resolve(root, "config/media-defaults.json"), "utf8")),
  );
  if (!mediaSettings.pronunciationVoice) throw new Error("pronunciation_voice_missing");
  const appRequire = createRequire(resolve(root, "apps/web/package.json"));
  const ffmpeg: string = appRequire("ffmpeg-static");
  const speechLog: Array<{
    target: string;
    voice?: string;
    characters: number;
    generationId: string | null;
  }> = [];
  class MeasuredProvider extends OpenRouterProvider {
    override async speech(input: Parameters<OpenRouterProvider["speech"]>[0]) {
      const result = await super.speech(input);
      speechLog.push({
        target: input.text,
        voice: input.voice,
        characters: result.usage.characters ?? 0,
        generationId: result.requestId,
      });
      return result;
    }
  }
  const provider = new MeasuredProvider(key, settings);
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 3 });
  let syntheticOwner: string | undefined;
  let isolatedKind: string | undefined;
  const report: Record<string, unknown> = {
    evaluatedAt: new Date().toISOString(),
    syntheticOnly: true,
    model: settings.ttsModel,
    voice: mediaSettings.pronunciationVoice,
    configurationVersion: settings.version,
    humanListeningPerformed: false,
    cloudDatabaseWrites: false,
  };
  const observations: Array<Record<string, unknown>> = [];
  const decodedClips: Buffer[] = [];
  try {
    await mkdir(output, { recursive: true });
    const fixture = await studyFixture(db, { count: 0 });
    syntheticOwner = fixture.ctx.userId;
    await grantEntitlement(db, {
      userId: syntheticOwner,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
      amounts: amounts({
        tts: targets.reduce((sum, target) => sum + target.length, 0),
        storage: mediaSettings.maxTtsBytes * targets.length,
      }),
      operationKey: randomUUID(),
      actorId: "d46-synthetic-evaluation",
      reason: "Explicitly authorized synthetic live pronunciation evaluation",
    });
    const kind = `media.d46_live_${randomUUID().replaceAll("-", "")}`;
    isolatedKind = kind;
    report.isolatedJobKind = kind;
    const dependencies: MediaDependencies = {
      provider,
      store: new MemoryObjectStore(),
      settings: mediaSettings,
      processor: {
        schedule: (tx, ctx, input, now) =>
          scheduleAuxiliaryRun(tx, ctx, { ...input, job: { ...input.job, kind } }, now),
        execute: executeAuxiliaryProviderStep,
        complete: completeAuxiliaryRun,
        fail: failAuxiliaryRun,
      },
    };
    for (const [index, text] of targets.entries()) {
      console.log(`Preparing synthetic pronunciation ${index + 1}/${targets.length}.`);
      const request = {
        sessionId: fixture.session.id,
        text,
        purpose: "pronunciation",
        exportAllowed: false,
        operationKey: randomUUID(),
      };
      const asset = await requestTts(db, fixture.ctx, request, dependencies);
      const job = { ...mediaTtsJob(dependencies), kind };
      const summary = await runDueJobs(db, [job], {
        deadline: new Date(Date.now() + settings.timeoutMs + 15000),
        kinds: [kind],
      });
      const complete = await getMediaAsset(db, fixture.ctx, asset.id);
      if (complete.state !== "ready")
        throw new Error(`speech_${complete.lastError ?? complete.state}`);
      const { bytes } = await readMediaBytes(db, dependencies.store, fixture.ctx, asset.id);
      const path = resolve(output, `${index + 1}-${text.replaceAll(" ", "-")}.mp3`);
      await writeFile(path, bytes);
      const pcm = decode(ffmpeg, path);
      decodedClips.push(pcm);
      const callsBefore = speechLog.length;
      const cached = await requestTts(
        db,
        fixture.ctx,
        { ...request, operationKey: randomUUID() },
        dependencies,
      );
      const repeatedJob = await runDueJobs(db, [job], {
        deadline: new Date(Date.now() + 1000),
        kinds: [kind],
      });
      const cacheVerified =
        cached.id === asset.id && callsBefore === speechLog.length && repeatedJob.succeeded === 0;
      if (!cacheVerified) throw new Error("speech_cache_not_reused");
      observations.push({
        target: text,
        mediaId: asset.id,
        reusedMediaId: cached.id,
        speechCallsBeforeReplay: callsBefore,
        speechCallsAfterReplay: speechLog.length,
        replayWorkerSucceeded: repeatedJob.succeeded,
        path,
        bytes: bytes.length,
        ...integrity(pcm),
        generationId: speechLog.at(-1)?.generationId,
        cost: await generationCost(key, speechLog.at(-1)?.generationId ?? null),
        cacheVerified,
        initialWorkerSucceeded: summary.succeeded,
      });
      report.observations = observations;
      await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    }
    const billing = await allowance(db, fixture.ctx);
    const stored = await readSyntheticPronunciationCosts(
      db,
      LOCAL_APP_DATABASE_URL,
      syntheticOwner,
    );
    report.localAccounting = {
      consumedTtsCharacters: billing.consumed.tts,
      reservedTtsCharacters: billing.reserved.tts,
      speechCalls: speechLog.length,
      cacheReplays: targets.length,
      costLedger: stored,
    };
    if (process.argv.includes("--asr")) {
      const joined = Buffer.concat(
        decodedClips.flatMap((pcm) => [pcm, Buffer.alloc(sampleRate * 4)]),
      );
      const pcmPath = resolve(output, "combined.f32le");
      const combinedPath = resolve(output, "combined-check.mp3");
      await writeFile(pcmPath, joined);
      const conversion = spawnSync(
        ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "f32le",
          "-ar",
          String(sampleRate),
          "-ac",
          "1",
          "-i",
          pcmPath,
          "-codec:a",
          "libmp3lame",
          "-y",
          combinedPath,
        ],
        { windowsHide: true, timeout: 30000 },
      );
      if (conversion.status !== 0) throw new Error("combined_audio_failed");
      console.log("Checking intelligibility with one combined Whisper request.");
      const durationMs = Math.ceil((joined.length / 4 / sampleRate) * 1000);
      const asr = await provider.transcribe({
        operationKey: randomUUID(),
        model: settings.sttModel,
        audio: { bytes: new Uint8Array(await readFile(combinedPath)), format: "mp3" },
        durationMs,
      });
      report.asr = {
        model: settings.sttModel,
        path: combinedPath,
        transcript: asr.output.text,
        expected: targets.join(". "),
        normalizedMatch:
          asr.output.text
            .toLocaleLowerCase("en")
            .replace(/[^a-z\s]/g, "")
            .trim()
            .replace(/\s+/g, " ") === targets.join(" "),
        usage: asr.usage,
        actualMicros: asr.actualMicros,
        generationId: asr.requestId,
        cost: await generationCost(key, asr.requestId),
        limitation:
          "ASR intelligibility evidence only; no human listening or British IPA/accent/homograph certification.",
      };
    }
    report.status = "complete";
    await refreshCosts(key, report);
  } finally {
    if (syntheticOwner) {
      Object.assign(
        report,
        await cleanupSyntheticPronunciationFixture(
          LOCAL_ADMIN_DATABASE_URL,
          syntheticOwner,
          isolatedKind,
        ),
      );
    }
    await db.destroy();
    report.observations = observations;
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error: unknown) => {
  console.error(
    `Pronunciation evaluation stopped: ${error instanceof Error && /^[a-z0-9_]+$/i.test(error.message) ? error.message : "evaluation_failed"}.`,
  );
  process.exitCode = 1;
});
