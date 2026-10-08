import { z } from "zod";
import { lockAccount, lockAccountForCleanup } from "../acc";
import type { Database, Tx } from "../db";
import {
  deleteObject,
  errors,
  type LearnerContext,
  type ObjectStore,
  ownedObjectMetadata,
  writeOwnedObject,
} from "../plt";
import { invalidateAutomaticVoice } from "./automatic";
import {
  VOICE_CONSENT_VERSION,
  type VoiceEnrollment,
  type VoiceProfileView,
  voiceEmbeddingSchema,
} from "./contracts";
import {
  assertVoiceEnrollmentAttempt,
  completeVoiceEnrollment,
  type VoiceEnrollmentAttempt,
} from "./enrollment";
import { voiceReferenceConsistency, voiceReferences } from "./policy";
import { voiceAcceptancePolicy } from "./policy-registry";

export const enrollmentEmbeddingsSchema = z
  .array(
    z.strictObject({
      vector: voiceEmbeddingSchema,
      modelVersion: z.string().min(1),
      analysisId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
    }),
  )
  .max(6);
export async function voiceTransaction<T>(
  db: Database | Tx,
  effect: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.isTransaction ? effect(db as Tx) : db.transaction().execute(effect);
}
export async function getVoiceEnrollment(
  db: Database | Tx,
  ctx: LearnerContext,
): Promise<VoiceEnrollment> {
  const row = await db
    .selectFrom("voc.profile")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  return row
    ? {
        version: row.version,
        enabled: row.enabled,
        modelVersion: row.model_version,
        embeddings: row.enabled ? enrollmentEmbeddingsSchema.parse(row.embeddings) : [],
      }
    : { version: 0, enabled: false, modelVersion: null, embeddings: [] };
}
export async function getVoiceProfile(
  db: Database | Tx,
  ctx: LearnerContext,
  engineAvailable = false,
  modelRevision?: string,
): Promise<VoiceProfileView> {
  const row = await db
    .selectFrom("voc.profile")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  const embeddings = row?.enabled ? enrollmentEmbeddingsSchema.parse(row.embeddings) : [];
  const confirmed = row?.enabled
    ? await db
        .selectFrom("voc.analysis")
        .select("session_id")
        .distinct()
        .where("user_id", "=", ctx.userId)
        .where("status", "=", "verified")
        .where("verification_method", "=", "manual")
        .execute()
    : [];
  const model = modelRevision ?? row?.model_version ?? null;
  const references = model
    ? voiceReferences(
        { version: row?.version ?? 0, enabled: true, modelVersion: model, embeddings },
        model,
      )
    : { sample: null, lessons: [] };
  return {
    version: row?.version ?? 0,
    enabled: row?.enabled ?? false,
    consentVersion: row?.consent_version ?? null,
    enrolled: embeddings.length > 0,
    sampleDurationMs: row?.sample_duration_ms ?? null,
    modelVersion: row?.model_version ?? null,
    confirmedLessons: confirmed.length,
    engineAvailable,
    readiness: {
      sample: references.sample !== null,
      references: references.lessons.length,
      automatic: !row?.enabled
        ? "off"
        : !references.sample
          ? "needs_sample"
          : !references.lessons.length
            ? "needs_class"
            : model && voiceAcceptancePolicy(model)?.autoAccept
              ? "ready"
              : "unavailable",
    },
  };
}
/** Consent is separate from a class recording; no microphone or sample storage precedes it. */
export async function enableVoice(
  db: Database | Tx,
  ctx: LearnerContext,
  consentVersion: string,
  now = new Date(),
): Promise<VoiceEnrollment> {
  if (consentVersion !== VOICE_CONSENT_VERSION)
    throw errors.validationFailed({ consent: ["current_voice_consent_required"] });
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await getVoiceEnrollment(tx, ctx);
    if (previous.enabled) return previous;
    await tx
      .insertInto("voc.profile")
      .values({
        user_id: ctx.userId,
        enabled: true,
        consent_version: consentVersion,
        consented_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          enabled: true,
          version: previous.version + 1,
          consent_version: consentVersion,
          consented_at: now,
          updated_at: now,
        }),
      )
      .execute();
    return getVoiceEnrollment(tx, ctx);
  });
}
export async function saveVoiceSample(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  input: {
    profileVersion: number;
    bytes: Uint8Array;
    mimeType: string;
    durationMs: number;
    modelVersion: string;
    embedding: number[];
    enrollmentAttempt?: VoiceEnrollmentAttempt;
  },
  now = new Date(),
): Promise<void> {
  const vector = voiceEmbeddingSchema.parse(input.embedding);
  if (input.durationMs < 15000 || input.durationMs > 35000 || input.bytes.length > 2100000)
    throw errors.validationFailed({ audio: ["voice_sample_duration_or_size"] });
  const objectId = await writeOwnedObject(db, store, ctx, {
    module: "voc",
    retention: "durable",
    bytes: input.bytes,
    contentType: input.mimeType,
    now,
    onRegistered: (id) =>
      voiceTransaction(db, async (tx) => {
        await lockAccount(tx, ctx.userId);
        const profile = await getVoiceEnrollment(tx, ctx);
        if (!profile.enabled || profile.version !== input.profileVersion) throw errors.conflict();
        if (input.enrollmentAttempt)
          await assertVoiceEnrollmentAttempt(tx, ctx, input.enrollmentAttempt, now);
        await tx
          .insertInto("voc.sample_object")
          .values({ object_id: id, user_id: ctx.userId, created_at: now })
          .execute();
      }),
  });
  try {
    await voiceTransaction(db, async (tx) => {
      await lockAccount(tx, ctx.userId);
      const profile = await getVoiceEnrollment(tx, ctx);
      if (!profile.enabled || profile.version !== input.profileVersion) throw errors.conflict();
      if (input.enrollmentAttempt)
        await assertVoiceEnrollmentAttempt(tx, ctx, input.enrollmentAttempt, now);
      const registered = await tx
        .selectFrom("voc.sample_object")
        .select("retired_at")
        .where("object_id", "=", objectId)
        .where("user_id", "=", ctx.userId)
        .executeTakeFirst();
      if (!registered || registered.retired_at) throw errors.conflict();
      const metadata = await ownedObjectMetadata(tx, ctx, objectId);
      if (metadata.state !== "verified") throw errors.conflict();
      // Confirmed classes stay references only while they still sound like the new sample.
      const policy = voiceAcceptancePolicy(input.modelVersion);
      const lessons = profile.embeddings
        .filter((entry) => entry.analysisId && entry.modelVersion === input.modelVersion)
        .slice(0, 4);
      const kept = lessons.filter(
        (entry) =>
          voiceReferenceConsistency(entry.vector, { sample: vector, lessons: [] }, policy) !==
          "mismatch",
      );
      const dropped = lessons.flatMap((entry) =>
        entry.analysisId && !kept.includes(entry) ? [entry.analysisId] : [],
      );
      const entries = [
        {
          vector,
          modelVersion: input.modelVersion,
          analysisId: null,
          createdAt: now.toISOString(),
        },
        ...kept,
      ];
      if (dropped.length)
        await tx
          .updateTable("voc.analysis")
          .set((eb) => ({
            version: eb("version", "+", 1),
            reference_status: "mismatch",
            updated_at: now,
          }))
          .where("user_id", "=", ctx.userId)
          .where("id", "in", dropped)
          .where("verification_method", "=", "manual")
          .execute();
      // Automatic matches were made against the replaced sample; each class asks again.
      if (profile.embeddings.some((entry) => entry.analysisId === null))
        await invalidateAutomaticVoice(tx, ctx.userId, now);
      await tx
        .updateTable("voc.profile")
        .set({
          sample_object_id: objectId,
          sample_duration_ms: input.durationMs,
          model_version: input.modelVersion,
          embeddings: JSON.stringify(entries),
          updated_at: now,
        })
        .where("user_id", "=", ctx.userId)
        .execute();
      if (input.enrollmentAttempt)
        await completeVoiceEnrollment(tx, ctx, input.enrollmentAttempt, now);
    });
  } catch (error) {
    await deleteObject(db, store, ctx, objectId, now);
    throw error;
  }
  await cleanupVoiceSampleObjects(db, store, ctx, now);
}
export async function cleanupVoiceSampleObjects(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  now = new Date(),
) {
  const objects = await db
    .selectFrom("voc.sample_object")
    .select("object_id")
    .where("user_id", "=", ctx.userId)
    .execute();
  for (const object of objects) {
    const retired = await voiceTransaction(db, async (tx) => {
      await lockAccountForCleanup(tx, ctx.userId);
      const profile = await tx
        .selectFrom("voc.profile")
        .select(["sample_object_id", "enabled"])
        .where("user_id", "=", ctx.userId)
        .executeTakeFirst();
      const current = await tx
        .selectFrom("voc.sample_object")
        .select(["created_at", "retired_at"])
        .where("object_id", "=", object.object_id)
        .where("user_id", "=", ctx.userId)
        .executeTakeFirst();
      if (!current || (profile?.enabled && profile.sample_object_id === object.object_id))
        return false;
      if (
        !current.retired_at &&
        profile?.enabled &&
        current.created_at.getTime() > now.getTime() - 3600000
      )
        return false;
      await tx
        .updateTable("voc.sample_object")
        .set({ retired_at: current.retired_at ?? now })
        .where("object_id", "=", object.object_id)
        .where("user_id", "=", ctx.userId)
        .execute();
      return true;
    });
    if (!retired) continue;
    await deleteObject(db, store, ctx, object.object_id, now);
    await db
      .deleteFrom("voc.sample_object")
      .where("object_id", "=", object.object_id)
      .where("user_id", "=", ctx.userId)
      .execute();
  }
}
/** Immediately revokes all derived identities before object deletion; late workers cannot republish. */
export async function revokeVoiceData(
  db: Database | Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await voiceTransaction(db, async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const profile = await getVoiceEnrollment(tx, ctx);
    await tx
      .updateTable("voc.profile")
      .set({
        enabled: false,
        version: profile.version + 1,
        consent_version: null,
        consented_at: null,
        sample_object_id: null,
        sample_duration_ms: null,
        model_version: null,
        embeddings: "[]",
        updated_at: now,
      })
      .where("user_id", "=", ctx.userId)
      .execute();
    await tx.deleteFrom("voc.feedback").where("user_id", "=", ctx.userId).execute();
    await tx.deleteFrom("voc.analysis").where("user_id", "=", ctx.userId).execute();
    // Retirement belongs to the revocation transaction. Re-enabling before physical
    // cleanup must not make these old bytes look like a new in-flight enrollment.
    await tx
      .updateTable("voc.sample_object")
      .set({ retired_at: now })
      .where("user_id", "=", ctx.userId)
      .where("retired_at", "is", null)
      .execute();
    await tx
      .updateTable("voc.enrollment_request")
      .set({
        state: "revoked",
        request_hash: null,
        attempt_id: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .where("user_id", "=", ctx.userId)
      .execute();
  });
}
