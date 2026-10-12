import type { Selectable } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import { isExplanationLanguage, matchesExplanationScript } from "../lkm";
import { assertSessionOwner } from "../org";
import { canonicalJson, errors, type LearnerContext } from "../plt";
import { getSource, sessionSources, sourceContentVersions } from "../src";
import { invalidateAutomaticVoice } from "./automatic";
import { accountVoiceCalibration } from "./calibration";
import {
  type ClassVoiceEntry,
  type ClassVoiceView,
  type PrivateVoiceAnalysis,
  type SpokenMistake,
  spokenMistakeSchema,
  VOICE_MATCH_REASONS,
  VOICE_REFERENCE_STATUSES,
  type VoiceAnalysisInput,
  type VoiceAnalysisView,
  type VoiceEnrollment,
  type VoiceLineView,
  type VoiceMatchReason,
  type VoiceUtterance,
  voiceActionSchema,
  voiceCandidateSchema,
  voiceClassActionSchema,
  voiceCoverage,
  voiceEmbeddingSchema,
  voiceLineActionSchema,
  voiceUtteranceSchema,
} from "./contracts";
import { linkClassVoices, type SpeakerLinks, speakerLinksByAnalysis } from "./linking";
import { withListeningClips } from "./listening";
import {
  autoAcceptVoice,
  compareVoiceCandidates,
  rankVoiceCandidates,
  suggestedVoice,
  suggestibleVoice,
  voiceCosine,
} from "./matching";
import { decideVoiceMatch, voiceReferenceOutcome, voiceReferences } from "./policy";
import { voiceAcceptancePolicy } from "./policy-registry";
import { checkedVoiceEnrollment, getVoiceEnrollment, voiceTransaction } from "./profile";
import { readVoiceSettings, type VoiceSettings } from "./settings";
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
const turnEmbeddingsSchema = z
  .array(z.strictObject({ utteranceId: z.string(), vector: voiceEmbeddingSchema }))
  .max(2000);
const speakerLinksSchema = z.record(
  z.string(),
  z.strictObject({ voiceId: z.string(), ambiguous: z.boolean() }),
);
const lineChoicesSchema = z.record(z.string(), z.enum(["mine", "not_mine"]));
/** Proposed target-speaker lines a part offers at most. */
const MAX_PROPOSED_LINES = 20;
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
function publicView(row: Row, settings: VoiceSettings = readVoiceSettings()): VoiceAnalysisView {
  const rejected = z.array(z.string()).parse(row.rejected_ids);
  const acoustic = row.model_version !== TRANSCRIPT_LABEL_MODEL;
  const candidates = candidatesSchema
    .parse(row.candidates)
    .filter((candidate) => !rejected.includes(candidate.id));
  const links = speakerLinksSchema.parse(row.speaker_links);
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
    candidates: withListeningClips(candidates, utterancesSchema.parse(row.utterances)),
    shortCandidateIds: candidates
      .filter((candidate) => !suggestibleVoice(candidate, acoustic))
      .map((candidate) => candidate.id),
    speakerLinks: Object.fromEntries(
      Object.entries(links).filter(([speakerId]) =>
        candidates.some((candidate) => candidate.id === speakerId),
      ),
    ),
    ...(settings.targetTurns ? { lines: voiceLines(row, settings) } : {}),
  };
}
/**
 * Lines a learner may mark as theirs: turns of other voices whose own clean speech resembles the
 * learner's sample, and every line already chosen. A proposal, never an attribution.
 */
function voiceLines(row: Row, settings: VoiceSettings): VoiceLineView[] {
  const utterances = utterancesSchema.parse(row.utterances);
  const choices = lineChoicesSchema.parse(row.line_choices);
  const proposed = (item: VoiceUtterance) =>
    item.speakerId !== row.verified_speaker_id &&
    item.targetScore !== undefined &&
    item.targetScore >= settings.targetTurnMinScore;
  const proposals = utterances
    .filter(proposed)
    .sort((a, b) => (b.targetScore ?? 0) - (a.targetScore ?? 0) || a.startMs - b.startMs)
    .slice(0, MAX_PROPOSED_LINES);
  const listed = new Set(proposals.map((item) => item.id));
  return utterances
    .filter((item) => listed.has(item.id) || Object.hasOwn(choices, item.id))
    .sort((a, b) => a.startMs - b.startMs)
    .map((item) => ({
      utteranceId: item.id,
      speakerId: item.speakerId,
      startMs: item.startMs,
      endMs: item.endMs,
      text: item.text.slice(0, 4000),
      proposed: listed.has(item.id),
      choice: choices[item.id] ?? null,
    }));
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
    const settings = readVoiceSettings();
    const scored = settings.targetTurns
      ? scoreTargetTurns(
          utterances,
          turnEmbeddingsSchema.parse(input.turnEmbeddings ?? []),
          profile,
          input.modelVersion,
        )
      : utterances;
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
        // Never a voice without a voiceprint, an excerpt or enough clean speech.
        candidate_id:
          accepted ??
          suggestedVoice(candidates, input.modelVersion !== TRANSCRIPT_LABEL_MODEL)?.id ??
          null,
        verified_speaker_id: accepted,
        verification_method: accepted ? "automatic" : null,
        reason: input.reason ?? null,
        match_reason: accepted ? null : matchReason,
        candidates: JSON.stringify(candidates),
        utterances: JSON.stringify(scored),
        // An automatic acceptance already relies on an enrolled voice. Other speakers'
        // biometric vectors need not survive this completed identity decision.
        private_embeddings: accepted ? "[]" : JSON.stringify(vectors),
        embeddings_expire_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await relinkClassVoices(tx, ctx, input.sessionId, now);
    return privateView(row);
  });
}
/**
 * Each scored turn's similarity to the learner's own sample of the same model revision. Turn
 * voiceprints are transient: they are compared here and never stored.
 */
export function scoreTargetTurns(
  utterances: readonly VoiceUtterance[],
  turns: readonly { utteranceId: string; vector: number[] }[],
  enrollment: Pick<VoiceEnrollment, "embeddings">,
  modelVersion: string,
): VoiceUtterance[] {
  const sample = enrollment.embeddings.find(
    (entry) => entry.analysisId === null && entry.modelVersion === modelVersion,
  )?.vector;
  return utterances.map((item) => {
    const { targetScore: _ignored, ...rest } = item;
    const scores = sample
      ? turns.flatMap((turn) => {
          if (turn.utteranceId !== item.id) return [];
          const value = voiceCosine(turn.vector, sample);
          return value === null ? [] : [value];
        })
      : [];
    return scores.length ? { ...rest, targetScore: Math.max(...scores) } : rest;
  });
}
/**
 * One speaker namespace per class (PRD-SPK-02): whenever a part is saved, the class's current
 * parts are linked again, so parts that arrive one by one (D60, D61) join the same voices. A part
 * still holding its temporary voiceprints takes part with all of them. A confirmed part has none
 * left (FR-VOC-007); it takes part through its confirmed voice's reference, when that voice became
 * one. A class voice keeps the id it already had, so parts not relinked stay consistent.
 */
export async function relinkClassVoices(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const current = (await currentVoiceRows(tx, ctx, sessionId)).filter(
    (row) => row.model_version !== TRANSCRIPT_LABEL_MODEL,
  );
  const profile = await getVoiceEnrollment(tx, ctx);
  const voices = current.flatMap((row) => {
    const live =
      row.embeddings_expire_at > now ? embeddingsSchema.parse(row.private_embeddings) : [];
    const anchor =
      !live.length && row.status === "verified" && row.verified_speaker_id
        ? profile.embeddings.find(
            (entry) => entry.analysisId === row.id && entry.modelVersion === row.model_version,
          )
        : undefined;
    const entries = live.length
      ? live
      : anchor && row.verified_speaker_id
        ? [{ speakerId: row.verified_speaker_id, vector: anchor.vector }]
        : [];
    return entries.map((entry) => ({
      analysisId: row.id,
      speakerId: entry.speakerId,
      modelVersion: row.model_version,
      vector: entry.vector,
    }));
  });
  const prior = new Map(
    current.flatMap((row) =>
      Object.entries(speakerLinksSchema.parse(row.speaker_links)).map(
        ([speakerId, link]) => [`${row.id}\u0000${speakerId}`, link.voiceId] as const,
      ),
    ),
  );
  // A voice split since keeps its id in one group only, never joining two groups' parts.
  const used = new Set<string>();
  const linked = speakerLinksByAnalysis(
    linkClassVoices(voices).map((voice) => {
      const kept = voice.members
        .flatMap((member) => prior.get(`${member.analysisId}\u0000${member.speakerId}`) ?? [])
        .sort()
        .find((id) => !used.has(id));
      const id = kept ?? voice.id;
      used.add(id);
      return { ...voice, id };
    }),
  );
  const taking = new Set(voices.map((voice) => `${voice.analysisId}\u0000${voice.speakerId}`));
  for (const row of current) {
    const previous = speakerLinksSchema.parse(row.speaker_links);
    // Speakers that took no part keep their links; those that did take the new ones.
    const next: SpeakerLinks = {
      ...Object.fromEntries(
        Object.entries(previous).filter(
          ([speakerId]) => !taking.has(`${row.id}\u0000${speakerId}`),
        ),
      ),
      ...(linked.get(row.id) ?? {}),
    };
    if (canonicalJson(next) === canonicalJson(previous)) continue;
    await tx
      .updateTable("voc.analysis")
      // Links never bump the part's version: a learner's choice on a part does not depend on
      // them, and a class choice re-reads them and refuses when the set of parts changed.
      .set({ speaker_links: JSON.stringify(next), updated_at: now })
      .where("id", "=", row.id)
      .execute();
  }
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
    const kept = withoutSpeakers(mistakes, rejected, mineLines(row));
    for (const id of Object.keys(mistakes)) if (!Object.hasOwn(kept, id)) delete mistakes[id];
    for (const [id, items] of Object.entries(kept)) mistakes[id] = items;
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
  const settings = readVoiceSettings();
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
  const analyses = await Promise.all(
    rows.map(async (row) => {
      const view = publicView(row, settings);
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
  );
  const classView = classVoiceEntries(analyses);
  return {
    features: { classConfirmation: settings.classConfirmation, lineChoices: settings.targetTurns },
    classVoices: classView.voices,
    classCandidateId: classView.candidateId,
    enabled: profile.enabled,
    engineAvailable,
    analyses,
  };
}
/**
 * The class's linked voices from its parts' views. Only linked voices (each with a voiceprint)
 * are class voices; the suggestion is the best-scored suggestible one that no part rejected,
 * never an unscored tie broken by id, and none at all while every part is already decided.
 */
export function classVoiceEntries(analyses: readonly VoiceAnalysisView[]): {
  voices: ClassVoiceEntry[];
  candidateId: string | null;
} {
  const groups = new Map<
    string,
    {
      members: { analysisId: string; speakerId: string }[];
      cleanSpeechMs: number;
      score: number | null;
      suggestible: boolean;
      persian: boolean;
      ambiguous: boolean;
    }
  >();
  for (const analysis of analyses)
    for (const [speakerId, { voiceId, ambiguous }] of Object.entries(analysis.speakerLinks ?? {})) {
      const candidate = analysis.candidates.find((item) => item.id === speakerId);
      if (!candidate) continue;
      const group = groups.get(voiceId) ?? {
        members: [],
        cleanSpeechMs: 0,
        score: null,
        suggestible: false,
        persian: candidate.label.startsWith("گوینده"),
        ambiguous: false,
      };
      group.ambiguous ||= ambiguous;
      group.members.push({ analysisId: analysis.id, speakerId });
      group.cleanSpeechMs += candidate.cleanSpeechMs;
      if (candidate.score !== null) group.score = Math.max(group.score ?? -1, candidate.score);
      group.suggestible ||= !(analysis.shortCandidateIds ?? []).includes(speakerId);
      groups.set(voiceId, group);
    }
  const ranked = [...groups.entries()].sort(
    ([idA, a], [idB, b]) =>
      Number(b.score !== null) - Number(a.score !== null) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      b.cleanSpeechMs - a.cleanSpeechMs ||
      idA.localeCompare(idB),
  );
  const voices = ranked.map(([id, group], index) => ({
    id,
    label: group.persian ? `گوینده ${index + 1}` : `Voice ${index + 1}`,
    ambiguous: group.ambiguous,
    cleanSpeechMs: group.cleanSpeechMs,
    members: group.members,
  }));
  const open = analyses.some((analysis) => analysis.status === "unverified");
  const candidate = open ? ranked.find(([, group]) => group.suggestible) : undefined;
  return { voices, candidateId: candidate?.[0] ?? null };
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
    return applyVoiceIdentity(tx, ctx, sessionId, input, now, { reference: true });
  });
}
/**
 * One identity change on one part, inside the caller's locked transaction. `reference: false`
 * confirms without teaching later matching, for the other parts of a class confirmed at once:
 * one class adds at most one reference, so it cannot push out other classes' references.
 */
async function applyVoiceIdentity(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  input: z.infer<typeof voiceActionSchema>,
  now: Date,
  options: { reference: boolean },
): Promise<VoiceAnalysisView> {
  {
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
    // Lines the learner marked as theirs keep their checked mistakes through any voice choice.
    const mine = mineLines(row);
    const mistakes = withoutSpeakers(
      mistakesSchema.parse(row.mistakes),
      input.action === "none"
        ? Object.keys(mistakesSchema.parse(row.mistakes))
        : !confirm && chosen
          ? [chosen.id]
          : [],
      mine,
    );
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
    if (
      options.reference &&
      confirm &&
      chosen &&
      !(keepExisting && row.verification_method === "manual")
    ) {
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
            : (suggestedVoice(
                [...remaining].sort(compareVoiceCandidates),
                row.model_version !== TRANSCRIPT_LABEL_MODEL,
              )?.id ?? null),
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
  }
}
/** Utterances the learner marked as theirs, honoured only while line choices are switched on. */
function mineLines(row: Pick<Row, "line_choices">): Set<string> {
  if (!readVoiceSettings().targetTurns) return new Set();
  return new Set(
    Object.entries(lineChoicesSchema.parse(row.line_choices))
      .filter(([, choice]) => choice === "mine")
      .map(([id]) => id),
  );
}
/** Drops these speakers' suggestions, except those on lines the learner marked as theirs. */
function withoutSpeakers(
  mistakes: Record<string, SpokenMistake[]>,
  speakerIds: readonly string[],
  mine: ReadonlySet<string>,
): Record<string, SpokenMistake[]> {
  const result = { ...mistakes };
  for (const id of speakerIds) {
    const kept = (result[id] ?? []).filter((mistake) => mine.has(mistake.utteranceId));
    if (kept.length) result[id] = kept;
    else delete result[id];
  }
  return result;
}
/**
 * One choice for the whole class (PRD-SPK-02; switch `classConfirmation`). The learner saw every
 * current part at a version; any change since refuses the choice. A confirmed class voice
 * confirms its linked speaker in each part that has one, and only the part with the most clean
 * speech may become a reference. Parts without a linked speaker are left for their own choice.
 */
export async function changeClassVoiceIdentity(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  raw: z.infer<typeof voiceClassActionSchema>,
  now = new Date(),
): Promise<VoiceAnalysisView[]> {
  const input = voiceClassActionSchema.parse(raw);
  if (!readVoiceSettings().classConfirmation)
    throw errors.validationFailed({ voice: ["class_confirmation_off"] });
  if ((input.action === "confirm" || input.action === "reject") && !input.classVoiceId)
    throw errors.validationFailed({ voice: ["candidate_unavailable"] });
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const rows = await currentVoiceRows(tx, ctx, sessionId);
    const expected = new Map(input.expected.map((item) => [item.analysisId, item.version]));
    if (rows.length !== expected.size || rows.some((row) => expected.get(row.id) !== row.version))
      throw errors.conflict();
    const member = (row: Row) =>
      Object.entries(speakerLinksSchema.parse(row.speaker_links)).find(
        ([, link]) => link.voiceId === input.classVoiceId,
      )?.[0];
    const linked = rows.filter((row) => member(row));
    if (input.classVoiceId && !linked.length)
      throw errors.validationFailed({ voice: ["candidate_unavailable"] });
    const cleanSpeech = (row: Row) =>
      candidatesSchema.parse(row.candidates).find((candidate) => candidate.id === member(row))
        ?.cleanSpeechMs ?? 0;
    // The reference part is confirmed last, so it leads the profile's references.
    const ordered = [...rows].sort(
      (a, b) => cleanSpeech(a) - cleanSpeech(b) || a.id.localeCompare(b.id),
    );
    const referencePart = ordered.filter((row) => member(row)).at(-1)?.id;
    const views: VoiceAnalysisView[] = [];
    for (const row of ordered) {
      const speakerId = member(row);
      const step = (action: "confirm" | "reject" | "none" | "revoke", speaker?: string) =>
        applyVoiceIdentity(
          tx,
          ctx,
          sessionId,
          {
            action,
            analysisId: row.id,
            expectedVersion: row.version,
            ...(speaker ? { speakerId: speaker } : {}),
          },
          now,
          { reference: row.id === referencePart },
        );
      const rejected = z.array(z.string()).parse(row.rejected_ids);
      if (input.action === "confirm") {
        if (!speakerId || (row.status === "verified" && row.verified_speaker_id === speakerId))
          continue;
        if (row.status === "verified") await step("revoke");
        const current = await ownedAnalysis(tx, ctx, row.id);
        views.push(
          await applyVoiceIdentity(
            tx,
            ctx,
            sessionId,
            {
              action: "confirm",
              analysisId: row.id,
              expectedVersion: current.version,
              speakerId,
            },
            now,
            { reference: row.id === referencePart },
          ),
        );
      } else if (input.action === "reject") {
        if (!speakerId || rejected.includes(speakerId)) continue;
        if (row.status === "verified" && row.verified_speaker_id === speakerId)
          views.push(await step("revoke"));
        else if (row.status === "unverified") views.push(await step("reject", speakerId));
      } else if (input.action === "none") {
        if (row.status === "unverified") views.push(await step("none"));
      } else if (
        row.status === "verified" &&
        (!input.classVoiceId || row.verified_speaker_id === speakerId)
      )
        views.push(await step("revoke"));
    }
    return views;
  });
}
/** The learner marks one transcript line as theirs or not (switch `targetTurns`). */
export async function changeVoiceLine(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  raw: z.infer<typeof voiceLineActionSchema>,
  now = new Date(),
): Promise<VoiceAnalysisView> {
  const input = voiceLineActionSchema.parse(raw);
  if (!readVoiceSettings().targetTurns)
    throw errors.validationFailed({ voice: ["line_choices_off"] });
  return voiceTransaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const row = await ownedAnalysis(tx, ctx, input.analysisId);
    if (row.session_id !== sessionId) throw errors.notFound();
    if (row.version !== input.expectedVersion) throw errors.conflict();
    if (!(await currentVoiceRows(tx, ctx, sessionId)).some((current) => current.id === row.id))
      throw errors.conflict();
    if (!utterancesSchema.parse(row.utterances).some((item) => item.id === input.utteranceId))
      throw errors.validationFailed({ voice: ["line_unavailable"] });
    const choices = lineChoicesSchema.parse(row.line_choices);
    if (input.choice === "clear") delete choices[input.utteranceId];
    else choices[input.utteranceId] = input.choice;
    const updated = await tx
      .updateTable("voc.analysis")
      .set({
        version: row.version + 1,
        line_choices: JSON.stringify(choices),
        updated_at: now,
      })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return publicView(updated);
  });
}
