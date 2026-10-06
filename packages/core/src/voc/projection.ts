import { z } from "zod";
import type { Database, Tx } from "../db";
import { type KnowledgeModel, visibleMistakePatterns } from "../lkm";
import type { LearnerContext } from "../plt";
import { currentVoiceRows } from "./analysis";
import { spokenMistakeSchema, voiceUtteranceSchema } from "./contracts";
import { findRepeatedVoiceEvidence } from "./spoken-evidence";

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
  const verified = rows.filter((row) => row.status === "verified" && row.verified_speaker_id);
  const spoken = verified
    .flatMap((row) => {
      const utterances = z.array(voiceUtteranceSchema).parse(row.utterances);
      const mistakes = z.record(z.string(), z.array(spokenMistakeSchema)).parse(row.mistakes);
      return (mistakes[row.verified_speaker_id ?? ""] ?? []).flatMap((mistake) => {
        const utterance = utterances.find(
          (item) =>
            item.id === mistake.utteranceId &&
            item.eligible &&
            item.speakerId === row.verified_speaker_id,
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
                where: `صوت · ${timestamp(utterance.startMs)}–${timestamp(utterance.endMs)}`,
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
        speechStatus: verified.length
          ? "verified"
          : rows.length || notes.mistakes?.speechStatus !== "no_audio"
            ? "unverified"
            : "no_audio",
        pendingSpeech: rows.some((row) => row.status !== "verified"),
        patterns: visibleMistakePatterns(visible),
        items: visible,
      },
    },
  };
}
