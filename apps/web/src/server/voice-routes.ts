import "server-only";
import { createHash } from "node:crypto";
import { lockAccount } from "@recalino/core/acc";
import {
  cleanupHtmlExports,
  tombstoneAccountHtmlExports,
  tombstoneSessionHtmlExports,
} from "@recalino/core/html";
import {
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  runIdempotent,
} from "@recalino/core/plt";
import { voiceProcessingStatus } from "@recalino/core/proc";
import {
  beginVoiceEnrollment,
  changeVoiceIdentity,
  cleanupVoiceSampleObjects,
  completeVoiceEnrollment,
  failVoiceEnrollment,
  getClassVoice,
  getVoiceProfile,
  revokeVoiceData,
  saveVoiceSample,
  voiceActionSchema,
  voiceEnrollmentSchema,
} from "@recalino/core/voc";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { decodeVoiceAudio } from "./audio-preparer";
import { runJobsSoon } from "./jobs";
import { getObjectStore } from "./storage";
import { loadVoiceEngine } from "./voice-engine";
import { queueVoiceAnalysis } from "./voice-processing";

function actor(ctx: RequestContext): LearnerContext {
  if (!ctx.userId) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}
function key(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key || !isValidIdempotencyKey(key))
    throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return key;
}
export async function voiceEngineAvailable() {
  try {
    await loadVoiceEngine();
    return true;
  } catch {
    return false;
  }
}
export function voiceProfileHandler(): Handler {
  return async ({ request, input, db, ctx }) => {
    const learner = actor(ctx);
    if (request.method === "GET")
      return { body: await getVoiceProfile(db, learner, await voiceEngineAvailable()) };
    const requestKey = key(request),
      store = getObjectStore();
    if (!store) throw errors.validationFailed({ voice: ["storage_unavailable"] });
    if (request.method === "DELETE") {
      await runIdempotent(
        db,
        {
          userId: learner.userId,
          key: requestKey,
          route: "voice.delete",
          requestHash: "voice.delete.v1",
          ttlSeconds: 86400,
          beforeKey: (tx) => lockAccount(tx, learner.userId),
        },
        async (tx) => {
          await revokeVoiceData(tx, learner);
          await tombstoneAccountHtmlExports(tx, learner);
          return { status: 200, body: {} };
        },
      );
      await cleanupVoiceSampleObjects(db, store, learner);
      await cleanupHtmlExports(db, store, learner);
      return { body: await getVoiceProfile(db, learner, await voiceEngineAvailable()) };
    }
    const value = voiceEnrollmentSchema.parse(input);
    const claimed = await beginVoiceEnrollment(db, learner, {
      key: requestKey,
      requestHash: createHash("sha256").update(canonicalJson(value)).digest("hex"),
      consentVersion: value.consentVersion,
      expectedVersion: value.expectedVersion,
    });
    if (!claimed.completed) {
      try {
        // The receipt is committed before native work, and no database transaction spans inference.
        if (value.audioBase64 && value.mimeType) {
          const bytes = Buffer.from(value.audioBase64, "base64");
          let pcm: Awaited<ReturnType<typeof decodeVoiceAudio>> | undefined;
          try {
            if (bytes.byteLength > 2100000 || !bytes.byteLength)
              throw errors.validationFailed({ audio: ["voice_sample_size"] });
            const engine = await loadVoiceEngine().catch(() => {
              throw errors.validationFailed({ voice: ["voice_engine_unavailable"] });
            });
            pcm = await decodeVoiceAudio(bytes, 36000);
            if (pcm.durationMs < 15000 || pcm.durationMs > 35000)
              throw errors.validationFailed({ audio: ["voice_sample_duration"] });
            const diarized = await engine.diarize(pcm.samples, { sampleRate: pcm.sampleRate });
            const ids = new Set(diarized.segments.map((segment) => segment.speakerId));
            if (
              ids.size !== 1 ||
              diarized.speakers.length !== 1 ||
              (diarized.speakers[0]?.cleanSpeechMs ?? 0) < 15000
            )
              throw errors.validationFailed({ audio: ["one_clear_voice_required"] });
            const embedding = diarized.speakers[0]?.embedding;
            if (!embedding) throw errors.validationFailed({ audio: ["one_clear_voice_required"] });
            await saveVoiceSample(db, store, learner, {
              profileVersion: claimed.attempt.profileVersion,
              enrollmentAttempt: claimed.attempt,
              bytes,
              mimeType: value.mimeType,
              durationMs: Math.round(pcm.durationMs),
              modelVersion: engine.modelRevision,
              embedding,
            });
          } finally {
            pcm?.samples.fill(0);
            bytes.fill(0);
          }
        } else await completeVoiceEnrollment(db, learner, claimed.attempt);
      } catch (error) {
        await failVoiceEnrollment(db, learner, claimed.attempt);
        throw error;
      }
    }
    return { body: await getVoiceProfile(db, learner, await voiceEngineAvailable()) };
  };
}
export function classVoiceHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    z.uuid().parse(sessionId);
    const learner = actor(ctx);
    if (request.method === "GET")
      return {
        body: {
          ...(await getClassVoice(db, learner, sessionId, await voiceEngineAvailable())),
          processing: await voiceProcessingStatus(db, learner, sessionId),
        },
      };
    const requestKey = key(request);
    if (z.object({ action: z.literal("analyze") }).safeParse(input).success) {
      const run = await queueVoiceAnalysis(db, learner, sessionId, requestKey);
      runJobsSoon(["proc.voice_analysis"], 60);
      return { status: 202, body: run ?? {} };
    }
    const change = voiceActionSchema.parse(input);
    await runIdempotent(
      db,
      {
        userId: learner.userId,
        key: requestKey,
        route: `voice.class.${sessionId}`,
        requestHash: createHash("sha256").update(canonicalJson(change)).digest("hex"),
        ttlSeconds: 86400,
        beforeKey: (tx) => lockAccount(tx, learner.userId),
      },
      async (tx) => {
        await changeVoiceIdentity(tx, learner, sessionId, change);
        if (change.action === "confirm") await tombstoneSessionHtmlExports(tx, learner, sessionId);
        else await tombstoneAccountHtmlExports(tx, learner);
        return { status: 200, body: {} };
      },
    );
    const store = getObjectStore();
    if (store)
      await cleanupHtmlExports(
        db,
        store,
        learner,
        change.action === "confirm" ? { sessionId } : {},
      );
    return { body: await getClassVoice(db, learner, sessionId, await voiceEngineAvailable()) };
  };
}
