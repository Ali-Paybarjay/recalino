import { z } from "zod";
import type { Database, Tx } from "../db";
import { type KnowledgeModel, matchesExplanationScript, visibleMistakePatterns } from "../lkm";
import type { LearnerContext } from "../plt";
import { currentVoiceRows } from "./analysis";
import { spokenMistakeSchema, voiceUtteranceSchema } from "./contracts";
import { readVoiceSettings } from "./settings";
import { findRepeatedVoiceEvidence } from "./spoken-evidence";

const lineChoicesSchema = z.record(z.string(), z.enum(["mine", "not_mine"]));

const timestamp = (milliseconds: number) =>
  `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}`;
/** Read-time projection, never stored in notebook history. Revocation therefore hides every revision. */
export async function projectVerifiedSpeech(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  model: KnowledgeModel,
): Promise<KnowledgeModel> {
  const notes = model.classNotes;
  if (!notes) return model;
  const rows = await currentVoiceRows(db, ctx, sessionId);
  // Line choices count only while the switch is on (draft FR-VOC v3).
  const lineChoices = readVoiceSettings().targetTurns;
  const choicesOf = (row: (typeof rows)[number]) =>
    lineChoices ? lineChoicesSchema.parse(row.line_choices) : {};
  const verified = rows.filter((row) => row.status === "verified" && row.verified_speaker_id);
  const chosen = rows.filter((row) =>
    Object.values(choicesOf(row)).some((choice) => choice === "mine"),
  );
  const spoken = rows
    .filter((row) => verified.includes(row) || chosen.includes(row))
    .flatMap((row) => {
      const utterances = z.array(voiceUtteranceSchema).parse(row.utterances);
      const mistakes = z.record(z.string(), z.array(spokenMistakeSchema)).parse(row.mistakes);
      const choices = choicesOf(row);
      // The verified voice's lines, less those the learner said are not theirs, plus any other
      // line the learner marked as theirs. Every mistake keeps the same strict evidence rules.
      const owned = (utteranceId: string, speakerId: string) =>
        choices[utteranceId] === "mine" ||
        (row.status === "verified" &&
          speakerId === row.verified_speaker_id &&
          choices[utteranceId] !== "not_mine");
      return Object.entries(mistakes)
        .flatMap(([speakerId, items]) => items.map((mistake) => ({ speakerId, mistake })))
        .filter(({ speakerId, mistake }) => owned(mistake.utteranceId, speakerId))
        .flatMap(({ speakerId, mistake }) => {
          // Legacy corrections were Persian. A historical notebook must never receive a different locale.
          const storedLanguage = mistake.explanationLanguage ?? "fa";
          const expectedLanguage = model.language.explanation;
          if (
            storedLanguage.toLowerCase() !== expectedLanguage.toLowerCase() &&
            !(mistake.explanationLanguage === undefined && expectedLanguage.split("-")[0] === "fa")
          )
            return [];
          if (!matchesExplanationScript(mistake.whyFa, expectedLanguage)) return [];
          const utterance = utterances.find(
            (item) =>
              item.id === mistake.utteranceId && item.eligible && item.speakerId === speakerId,
          );
          return utterance && findRepeatedVoiceEvidence(utterances, mistake, utterance.speakerId)
            ? [
                {
                  source: "speech" as const,
                  said: mistake.said,
                  correct: mistake.correct,
                  whyFa: mistake.whyFa,
                  kind: mistake.kind,
                  teacherCorrected: false,
                  where: `${model.language.explanation.split("-")[0] === "fa" ? "صوت" : "Audio"} · ${timestamp(utterance.startMs)}–${timestamp(utterance.endMs)}`,
                  voiceEvidence: {
                    analysisId: row.id,
                    version: row.version,
                    sourceId: row.source_id,
                    sourceVersionId: row.source_version_id,
                    speakerId: utterance.speakerId,
                    startMs: utterance.startMs,
                    endMs: utterance.endMs,
                  },
                },
              ]
            : [];
        });
    })
    .slice(0, 15);
  const written = (notes.mistakes?.items ?? []).filter((item) => item.source === "handwriting");
  const visible = [...written, ...spoken].slice(0, 15);
  return {
    ...model,
    classNotes: {
      ...notes,
      mistakes: {
        ...notes.mistakes,
        speechStatus:
          verified.length || chosen.length
            ? "verified"
            : rows.length || notes.mistakes?.speechStatus !== "no_audio"
              ? "unverified"
              : "no_audio",
        pendingSpeech: rows.some((row) => row.status !== "verified"),
        patterns: visibleMistakePatterns(visible, model.language.explanation),
        items: visible,
      },
    },
  };
}
