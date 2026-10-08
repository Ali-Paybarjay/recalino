import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import { isExplanationLanguage, matchesExplanationScript } from "../lkm";
import { assertSessionOwner } from "../org";
import { errors, type LearnerContext } from "../plt";
import { getSource, sessionSources, sourceContentVersions } from "../src";
import {
  type ClassVoiceView,
  type PrivateVoiceAnalysis,
  type SpokenMistake,
  spokenMistakeSchema,
  type VoiceAnalysisInput,
  type VoiceAnalysisView,
  voiceActionSchema,
  voiceCandidateSchema,
  voiceCoverage,
  voiceEmbeddingSchema,
  voiceUtteranceSchema,
} from "./contracts";
import { autoAcceptVoice, calibrateVoiceAcceptance, rankVoiceCandidates } from "./matching";
import { getVoiceEnrollment, voiceTransaction } from "./profile";
import { findRepeatedVoiceEvidence } from "./spoken-evidence";

type Row = Selectable<DB["voc.analysis"]>;
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
    candidates: candidatesSchema
      .parse(row.candidates)
      .filter((candidate) => !rejected.includes(candidate.id)),
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
    const candidates = rankVoiceCandidates(declared, vectors, profile, input.modelVersion);
    const feedbackRows = await tx
      .selectFrom("voc.feedback as feedback")
      .innerJoin("voc.analysis as analysis", "analysis.id", "feedback.analysis_id")
      .select([
        "feedback.score",
        "feedback.margin",
        "feedback.accepted",
        "feedback.speaker_id as speakerId",
        "analysis.session_id as sessionId",
        "analysis.status",
        "analysis.verified_speaker_id as verifiedSpeakerId",
        "analysis.verification_method as method",
      ])
      .where("feedback.user_id", "=", ctx.userId)
      .where("analysis.user_id", "=", ctx.userId)
      .where("feedback.model_version", "=", input.modelVersion)
      .execute();
    const feedback = feedbackRows.filter(
      (item) =>
        !item.accepted ||
        (item.status === "verified" &&
          item.method === "manual" &&
          item.verifiedSpeakerId === item.speakerId),
    );
    const confirmed = await tx
      .selectFrom("voc.analysis")
      .select("session_id")
      .distinct()
      .where("user_id", "=", ctx.userId)
      .where("verification_method", "=", "manual")
      .where("status", "=", "verified")
      .execute();
    const accepted = autoAcceptVoice(
      candidates,
      calibrateVoiceAcceptance(input.modelVersion, feedback),
      input.modelVersion,
      confirmed.length,
    );
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
  return {
    enabled: (await getVoiceEnrollment(db, ctx)).enabled,
    engineAvailable,
    analyses: rows.map(publicView),
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
      const invalidated = await tx
        .updateTable("voc.analysis")
        .set((eb) => ({
          version: eb("version", "+", 1),
          status: "unverified",
          verified_speaker_id: null,
          verification_method: null,
          reason: "voice_reference_revoked",
          updated_at: now,
        }))
        .where("user_id", "=", ctx.userId)
        .where("verification_method", "=", "automatic")
        .where("id", "!=", row.id)
        .returning("id")
        .execute();
      const invalidIds = new Set(invalidated.map((entry) => entry.id));
      enrolled = enrolled.filter((entry) => !entry.analysisId || !invalidIds.has(entry.analysisId));
    }
    const vectors = embeddingsSchema.parse(row.private_embeddings);
    const vector =
      confirm && chosen && row.embeddings_expire_at > now
        ? vectors.find((entry) => entry.speakerId === chosen.id)?.vector
        : undefined;
    if (vector && chosen && chosen.cleanSpeechMs >= 20000) {
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
