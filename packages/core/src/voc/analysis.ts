import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import { isExplanationLanguage, matchesExplanationScript } from "../lkm";
import { assertSessionOwner } from "../org";
import { errors, type LearnerContext } from "../plt";
import { getSource, sessionSources, sourceContentVersions } from "../src";
import { invalidateAutomaticVoice } from "./automatic";
import { accountVoiceCalibration } from "./calibration";
import {
  type ClassVoiceView,
  type PrivateVoiceAnalysis,
  type SpokenMistake,
  spokenMistakeSchema,
  VOICE_MATCH_REASONS,
  VOICE_REFERENCE_STATUSES,
  type VoiceAnalysisInput,
  type VoiceAnalysisView,
  type VoiceMatchReason,
  voiceActionSchema,
  voiceCandidateSchema,
  voiceCoverage,
  voiceEmbeddingSchema,
  voiceUtteranceSchema,
} from "./contracts";
import { withListeningClips } from "./listening";
import { autoAcceptVoice, rankVoiceCandidates } from "./matching";
import { decideVoiceMatch, voiceReferenceOutcome, voiceReferences } from "./policy";
import { voiceAcceptancePolicy } from "./policy-registry";
import { checkedVoiceEnrollment, getVoiceEnrollment, voiceTransaction } from "./profile";
import { findRepeatedVoiceEvidence } from "./spoken-evidence";

type Row = Selectable<DB["voc.analysis"]>;
/** Speaker labels from a transcript, never acoustic voiceprints (proc/voice-processing.ts). */
const TRANSCRIPT_LABEL_MODEL = "transcript-labels-v1";
const candidatesSchema = z.array(voiceCandidateSchema).max(50);
const utterancesSchema = z.array(voiceUtteranceSchema).max(10000);
const mistakesSchema = z.record(z.string(), z.array(spokenMistakeSchema).max(15));
const embeddingsSchema = z
  .array(z.strictObject({ speakerId: z.string(), vector: voiceEmbeddingSchema }))
  .max(50);
function privateView(row: Row): PrivateVoiceAnalysis {
  return {
    id: row.id,
    version: row.version,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    runId: row.run_id,
    profileVersion: row.profile_version,
    modelVersion: row.model_version,
    status: row.status as VoiceAnalysisView["status"],
    candidateId: row.candidate_id,
    reason: row.reason,
    candidates: candidatesSchema.parse(row.candidates),
    utterances: utterancesSchema.parse(row.utterances),
    mistakes: mistakesSchema.parse(row.mistakes),
  };
}
function publicView(row: Row): VoiceAnalysisView {
  const rejected = z.array(z.string()).parse(row.rejected_ids);
  return {
    id: row.id,
    version: row.version,
    sourceId: row.source_id,
    status: row.status as VoiceAnalysisView["status"],
    candidateId: row.candidate_id,
    verifiedSpeakerId: row.verified_speaker_id,
    verificationMethod: row.verification_method as VoiceAnalysisView["verificationMethod"],
    reason: row.reason,
    referenceStatus: z.enum(VOICE_REFERENCE_STATUSES).nullable().parse(row.reference_status),
    matchReason: z.enum(VOICE_MATCH_REASONS).nullable().parse(row.match_reason),
    candidates: withListeningClips(
      candidatesSchema
        .parse(row.candidates)
        .filter((candidate) => !rejected.includes(candidate.id)),
      utterancesSchema.parse(row.utterances),
    ),
  };
}
async function ownedAnalysis(db: Database | Tx, ctx: LearnerContext, id: string): Promise<Row> {
  const row = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("id", "=", z.uuid().parse(id))
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  await assertSessionOwner(db, ctx, row.session_id);
  const profile = await getVoiceEnrollment(db, ctx);
  if (!profile.enabled || profile.version !== row.profile_version) throw errors.notFound();
  return row;
}
export async function findVoiceAnalysis(
  db: Database | Tx,
  ctx: LearnerContext,
  input: { sessionId: string; sourceId: string; sourceVersionId: string; runId: string },
): Promise<PrivateVoiceAnalysis | null> {
  await assertSessionOwner(db, ctx, input.sessionId);
  const profile = await getVoiceEnrollment(db, ctx);
  if (!profile.enabled) return null;
  const row = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", input.sessionId)
    .where("source_id", "=", input.sourceId)
    .where("source_version_id", "=", input.sourceVersionId)
    .where("run_id", "=", input.runId)
    .where("profile_version", "=", profile.version)
    .executeTakeFirst();
  return row ? privateView(row) : null;
}
export async function saveVoiceAnalysis(
  db: Database | Tx,
  ctx: LearnerContext,
  input: VoiceAnalysisInput,
  now = new Date(),
): Promise<PrivateVoiceAnalysis> {
  const utterances = utterancesSchema.parse(input.utterances);
  const vectors = embeddingsSchema.parse(input.embeddings);
  const declared = candidatesSchema.parse(input.candidates);
  if (
    new Set(declared.map((item) => item.id)).size !== declared.length ||
    utterances.some(
      (item) =>
        item.endMs <= item.startMs ||
        !declared.some((candidate) => candidate.id === item.speakerId),
    )
  )
    throw errors.validationFailed({ voice: ["invalid_diarization"] });
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    await assertSessionOwner(tx, ctx, input.sessionId);
    await getSource(tx, ctx, input.sourceId);
    const profile = await getVoiceEnrollment(tx, ctx);
    if (!profile.enabled || profile.version !== input.profileVersion) throw errors.conflict();
    const links = await sessionSources(tx, ctx, input.sessionId);
    if (!links.some((link) => link.assetId === input.sourceId)) throw errors.notFound();
    const versions = await sourceContentVersions(tx, ctx, input.sourceId);
    if (!versions.some((version) => version.id === input.sourceVersionId)) throw errors.notFound();
    const prior = await findVoiceAnalysis(tx, ctx, input);
    if (prior) return prior;
    const policy = voiceAcceptancePolicy(input.modelVersion);
    const enrollment = checkedVoiceEnrollment(profile, input.modelVersion, policy);
    const candidates = rankVoiceCandidates(declared, vectors, enrollment, input.modelVersion);
    const account = await accountVoiceCalibration(tx, ctx, input.modelVersion);
    let accepted: string | null = null;
    let matchReason: VoiceMatchReason | null = null;
    if (candidates.length && input.modelVersion !== TRANSCRIPT_LABEL_MODEL) {
      const decision = decideVoiceMatch({
        candidates,
        vectors,
        enrollment,
        modelVersion: input.modelVersion,
        policy,
        rejectedScores: account.rejectedScores,
      });
      accepted = decision.acceptedId;
      matchReason = decision.reason;
      // A model revision without an evaluated policy keeps the account's own calibration. An
      // evaluated policy replaces it, and one with automatic acceptance off keeps every class manual.
      if (!policy && account.calibration && account.confirmedLessons) {
        accepted = autoAcceptVoice(
          candidates,
          account.calibration,
          input.modelVersion,
          account.confirmedLessons,
        );
        // A calibration that declines is a weak match, not a switch that is off.
        matchReason = accepted
          ? null
          : matchReason === "policy_unavailable"
            ? "no_clear_match"
            : matchReason;
      }
    }
    const row = await tx
      .insertInto("voc.analysis")
      .values({
        user_id: ctx.userId,
        session_id: input.sessionId,
        source_id: input.sourceId,
        source_version_id: input.sourceVersionId,
        run_id: input.runId,
        profile_version: input.profileVersion,
        model_version: input.modelVersion,
        status: accepted
          ? "verified"
          : candidates.length
            ? "unverified"
            : [
                  "voice_analysis_failed",
                  "voice_inference_failed",
                  "voice_inference_timeout",
                  "voice_engine_unavailable",
                  "voice_decoder_timeout",
                  "voice_audio_unusable",
                  "voice_source_integrity_mismatch",
                ].includes(input.reason ?? "")
              ? "failed"
              : "unavailable",
        candidate_id: accepted ?? candidates[0]?.id ?? null,
        verified_speaker_id: accepted,
        verification_method: accepted ? "automatic" : null,
        reason: input.reason ?? null,
        match_reason: accepted ? null : matchReason,
        candidates: JSON.stringify(candidates),
        utterances: JSON.stringify(utterances),
        // An automatic acceptance already relies on an enrolled voice. Other speakers'
        // biometric vectors need not survive this completed identity decision.
        private_embeddings: accepted ? "[]" : JSON.stringify(vectors),
        embeddings_expire_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return privateView(row);
  });
}
const normalizedQuote = (value: string) => value.replaceAll("**", "").replace(/\s+/gu, " ").trim();
/** A language model cannot invent an utterance, its speaker, timestamps, or a teacher correction. */
export function validatedSpokenMistakes(
  analysis: Pick<PrivateVoiceAnalysis, "candidates" | "utterances">,
  raw: Record<string, SpokenMistake[]>,
  explanationLanguage = "fa",
): Record<string, SpokenMistake[]> {
  if (!isExplanationLanguage(explanationLanguage))
    throw errors.validationFailed({ voice: ["explanation_language_invalid"] });
  const value = mistakesSchema.parse(raw),
    result: Record<string, SpokenMistake[]> = {};
  for (const candidate of analysis.candidates) {
    result[candidate.id] = (value[candidate.id] ?? [])
      .filter((mistake) => {
        const utterance = analysis.utterances.find(
          (item) =>
            item.id === mistake.utteranceId && item.speakerId === candidate.id && item.eligible,
        );
        if (!utterance || utterance.endMs - utterance.startMs < 2000) return false;
        const said = normalizedQuote(mistake.said),
          original = normalizedQuote(utterance.text);
        return (
          (!mistake.explanationLanguage ||
            mistake.explanationLanguage.toLowerCase() === explanationLanguage.toLowerCase()) &&
          said.length > 0 &&
          original.includes(said) &&
          said !== normalizedQuote(mistake.correct) &&
          matchesExplanationScript(mistake.whyFa, explanationLanguage) &&
          Boolean(findRepeatedVoiceEvidence(analysis.utterances, mistake, candidate.id))
        );
      })
      .map((mistake) =>
        explanationLanguage === "fa" ? mistake : { ...mistake, explanationLanguage },
      );
  }
  return result;
}
export async function saveVoiceCandidateMistakes(
  db: Database | Tx,
  ctx: LearnerContext,
  input: {
    analysisId: string;
    profileVersion: number;
    mistakes: Record<string, SpokenMistake[]>;
    explanationLanguage?: string;
  },
  now = new Date(),
): Promise<void> {
  await voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await ownedAnalysis(tx, ctx, input.analysisId);
    if (row.profile_version !== input.profileVersion) throw errors.conflict();
    if (row.status === "none") return;
    const rejected = z.array(z.string()).parse(row.rejected_ids);
    const mistakes = validatedSpokenMistakes(
      privateView(row),
      input.mistakes,
      input.explanationLanguage,
    );
    for (const id of rejected) delete mistakes[id];
    await tx
      .updateTable("voc.analysis")
      .set({
        mistakes: JSON.stringify(mistakes),
        reason: row.reason?.startsWith("voice_correction_")
          ? voiceCoverage(row.reason)
          : row.reason,
        updated_at: now,
      })
      .where("id", "=", row.id)
      .execute();
  });
}
/** Keep the coverage disclosure through any correction failure, without doubling it. */
export function correctionFailureReason(reason: string, previous: string | null): string {
  const coverage = voiceCoverage(previous);
  if (!reason.startsWith("voice_correction_") || !coverage || voiceCoverage(reason)) return reason;
  return reason.replace("voice_correction_", `voice_correction_${coverage}_`);
}
export async function markVoiceAnalysisFailure(
  db: Database | Tx,
  ctx: LearnerContext,
  analysisId: string,
  reason: string,
  now = new Date(),
): Promise<PrivateVoiceAnalysis> {
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await ownedAnalysis(tx, ctx, analysisId);
    const updated = await tx
      .updateTable("voc.analysis")
      .set({
        reason: z
          .string()
          .regex(/^[a-z0-9_]{1,100}$/)
          .parse(correctionFailureReason(reason, row.reason)),
        updated_at: now,
      })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return privateView(updated);
  });
}
export async function currentVoiceRows(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<Row[]> {
  await assertSessionOwner(db, ctx, sessionId);
  const profile = await getVoiceEnrollment(db, ctx);
  if (!profile.enabled) return [];
  const links = await sessionSources(db, ctx, sessionId);
  const rows = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .distinctOn("source_id")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("profile_version", "=", profile.version)
    .orderBy("source_id")
    .orderBy("created_at", "desc")
    .orderBy("id")
    .execute();
  return rows.filter((row) =>
    links.some(
      (link) =>
        link.assetId === row.source_id &&
        link.selected &&
        (!link.contentVersionId || link.contentVersionId === row.source_version_id),
    ),
  );
}
export async function getClassVoice(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  engineAvailable = false,
): Promise<ClassVoiceView> {
  const rows = await currentVoiceRows(db, ctx, sessionId);
  const profile = await getVoiceEnrollment(db, ctx);
  const references = new Set(profile.embeddings.map((entry) => entry.analysisId));
  // References matching may rely on: under an evaluated policy, only those like the sample.
  const usable = (modelVersion: string) =>
    new Set(
      checkedVoiceEnrollment(
        profile,
        modelVersion,
        voiceAcceptancePolicy(modelVersion),
      ).embeddings.map((entry) => entry.analysisId),
    );
  return {
    enabled: profile.enabled,
    engineAvailable,
    analyses: await Promise.all(
      rows.map(async (row) => {
        const view = publicView(row);
        return {
          ...view,
          // The stored outcome is the moment of confirmation; say so when it no longer holds.
          referenceStatus:
            view.referenceStatus !== "added"
              ? view.referenceStatus
              : !references.has(row.id)
                ? ("retired" as const)
                : !usable(row.model_version).has(row.id)
                  ? ("mismatch" as const)
                  : view.referenceStatus,
          source: await sourceIdentity(db, ctx, row),
        };
      }),
    ),
  };
}
/** Name, length and checksum of the learner's own registered recording, for local playback. */
async function sourceIdentity(db: Database | Tx, ctx: LearnerContext, row: Row) {
  const asset = await getSource(db, ctx, row.source_id).catch(() => null);
  if (asset?.kind !== "audio") return null;
  return {
    name: asset.display_name,
    durationMs: asset.duration_ms === null ? null : Number(asset.duration_ms),
    sizeBytes: Number(asset.size_bytes),
    sha256: asset.sha256,
    mimeType: asset.verified_mime ?? asset.declared_mime,
  };
}
export async function changeVoiceIdentity(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  raw: z.infer<typeof voiceActionSchema>,
  now = new Date(),
): Promise<VoiceAnalysisView> {
  const input = voiceActionSchema.parse(raw);
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await ownedAnalysis(tx, ctx, input.analysisId);
    if (row.session_id !== sessionId) throw errors.notFound();
    if (row.version !== input.expectedVersion) throw errors.conflict();
    if (!(await currentVoiceRows(tx, ctx, sessionId)).some((current) => current.id === row.id))
      throw errors.conflict();
    const candidates = candidatesSchema.parse(row.candidates),
      rejected = z.array(z.string()).parse(row.rejected_ids);
    const chosenId = input.speakerId ?? row.verified_speaker_id ?? row.candidate_id;
    const chosen = candidates.find(
      (candidate) => candidate.id === chosenId && !rejected.includes(candidate.id),
    );
    if (input.action !== "none" && !chosen)
      throw errors.validationFailed({ voice: ["candidate_unavailable"] });
    const confirm = input.action === "confirm";
    if (confirm && row.status === "verified" && row.verified_speaker_id !== chosen?.id)
      throw errors.validationFailed({ voice: ["revoke_before_changing_speaker"] });
    if (chosen && chosen.score !== null) {
      const runner = candidates
        .filter((item) => item.id !== chosen.id && item.score !== null)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
      await tx
        .insertInto("voc.feedback")
        .values({
          user_id: ctx.userId,
          analysis_id: row.id,
          model_version: row.model_version,
          speaker_id: chosen.id,
          score: chosen.score,
          margin:
            runner?.score !== null && runner?.score !== undefined
              ? Math.max(0, chosen.score - runner.score)
              : null,
          accepted: confirm,
          created_at: now,
        })
        .onConflict((oc) =>
          oc
            .columns(["analysis_id", "speaker_id"])
            .doUpdateSet({ accepted: confirm, created_at: now }),
        )
        .execute();
    }
    if (!confirm && chosen) rejected.push(chosen.id);
    const remaining = candidates.filter((candidate) => !rejected.includes(candidate.id));
    const mistakes = mistakesSchema.parse(row.mistakes);
    if (!confirm && chosen) delete mistakes[chosen.id];
    if (input.action === "none") {
      for (const id of Object.keys(mistakes)) delete mistakes[id];
    }
    const profile = await getVoiceEnrollment(tx, ctx);
    const keepExisting =
      confirm && row.status === "verified" && row.verified_speaker_id === chosen?.id;
    let enrolled = profile.embeddings.filter(
      (entry) => entry.analysisId !== row.id || keepExisting,
    );
    if (!confirm && row.status === "verified") {
      // A revoked reference can have selected the same wrong voice in later lessons.
      const invalidIds = await invalidateAutomaticVoice(tx, ctx.userId, now, row.id);
      enrolled = enrolled.filter((entry) => !entry.analysisId || !invalidIds.has(entry.analysisId));
    }
    const vectors = embeddingsSchema.parse(row.private_embeddings);
    let referenceStatus =
      keepExisting && row.verification_method === "manual"
        ? z.enum(VOICE_REFERENCE_STATUSES).nullable().parse(row.reference_status)
        : null;
    if (confirm && chosen && !(keepExisting && row.verification_method === "manual")) {
      const expired = row.embeddings_expire_at <= now;
      const vector = expired
        ? undefined
        : vectors.find((entry) => entry.speakerId === chosen.id)?.vector;
      // The learner's choice stands either way; only a consistent, clear voice teaches matching.
      referenceStatus = voiceReferenceOutcome({
        acoustic: row.model_version !== TRANSCRIPT_LABEL_MODEL,
        vector,
        cleanSpeechMs: chosen.cleanSpeechMs,
        expired,
        references: voiceReferences(profile, row.model_version),
        policy: voiceAcceptancePolicy(row.model_version),
      });
      if (referenceStatus === "added" && vector) {
        const sample = enrolled.find((entry) => entry.analysisId === null);
        const lessons = [
          {
            vector,
            modelVersion: row.model_version,
            analysisId: row.id,
            createdAt: now.toISOString(),
          },
          ...enrolled.filter(
            (entry) =>
              entry.analysisId &&
              entry.analysisId !== row.id &&
              entry.modelVersion === row.model_version,
          ),
        ].slice(0, 4);
        // The separately retained recording must keep its rebuildable sample voiceprint.
        enrolled = [...lessons, ...(sample ? [sample] : [])];
      }
    }
    await tx
      .updateTable("voc.profile")
      .set({
        embeddings: JSON.stringify(enrolled),
        model_version: enrolled[0]?.modelVersion ?? null,
        updated_at: now,
      })
      .where("user_id", "=", ctx.userId)
      .execute();
    const updated = await tx
      .updateTable("voc.analysis")
      .set({
        version: row.version + 1,
        status: confirm
          ? "verified"
          : input.action === "none" || !remaining.length
            ? "none"
            : "unverified",
        candidate_id: confirm
          ? chosen?.id
          : input.action === "none"
            ? null
            : (remaining[0]?.id ?? null),
        verified_speaker_id: confirm ? chosen?.id : null,
        verification_method: confirm ? "manual" : null,
        reference_status: confirm ? referenceStatus : null,
        // The reason a past automatic check asked no longer describes a learner's decision.
        match_reason: null,
        rejected_ids: JSON.stringify(rejected),
        mistakes: JSON.stringify(mistakes),
        // Other people's voiceprints end with the confirmation process, never a persistent profile.
        private_embeddings:
          confirm || input.action === "none" ? "[]" : JSON.stringify(row.private_embeddings),
        updated_at: now,
      })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return publicView(updated);
  });
}
