import { randomUUID } from "node:crypto";
import type { Database } from "../src/db";
import {
  enableVoice,
  saveVoiceAnalysis,
  saveVoiceCandidateMistakes,
  type VoiceAnalysisInput,
} from "../src/voc";
import { studyFixture } from "./study-fixture";

export async function voiceFixture(db: Database) {
  const x = await studyFixture(db, { count: 0 }),
    now = new Date();
  const contractVersion = `voice-fixture-${randomUUID()}`;
  await db
    .insertInto("src.input_contract")
    .values({ version: contractVersion, active: false, rules: "{}" })
    .execute();
  const source = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "audio",
      declared_mime: "audio/wav",
      size_bytes: 100,
      sha256: "a".repeat(64),
      display_name: "Synthetic classroom",
      contract_version: contractVersion,
      retention: "device_only",
      duration_ms: 90000,
      operation_key: randomUUID(),
      request_hash: "fixture",
      verified_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const version = await db
    .insertInto("src.content_version")
    .values({
      asset_id: source.id,
      user_id: x.ctx.userId,
      origin_key: randomUUID(),
      sha256: "b".repeat(64),
      schema_version: "1",
      provenance: "machine_extraction",
      extraction_settings: "{}",
      units: "[]",
      blocks: "[]",
      request_hash: "fixture",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: source.id,
      role: "class_audio",
      selected: true,
      time_status: "exact",
      selected_content_version_id: version.id,
    })
    .execute();
  const enrollment = await enableVoice(db, x.ctx, "voice-v1", now);
  const input: VoiceAnalysisInput = {
    sessionId: x.session.id,
    sourceId: source.id,
    sourceVersionId: version.id,
    startedAt: new Date(now.getTime() - 5000),
    runId: randomUUID(),
    profileVersion: enrollment.version,
    modelVersion: "synthetic-voice-v1",
    candidates: [
      {
        id: "learner",
        label: "Learner candidate",
        score: null,
        cleanSpeechMs: 24000,
        clips: [{ startMs: 1000, endMs: 9000, text: "I goed home." }],
        lines: ["I goed home."],
      },
      {
        id: "classmate",
        label: "Other candidate",
        score: null,
        cleanSpeechMs: 25000,
        clips: [{ startMs: 10000, endMs: 18000, text: "She go yesterday." }],
        lines: ["She go yesterday."],
      },
    ],
    utterances: [
      {
        id: "u1",
        speakerId: "learner",
        startMs: 1000,
        endMs: 9000,
        text: "I goed home.",
        eligible: true,
      },
      {
        id: "u2",
        speakerId: "classmate",
        startMs: 10000,
        endMs: 18000,
        text: "She go yesterday.",
        eligible: true,
      },
      {
        id: "u1-repeat",
        speakerId: "learner",
        startMs: 40000,
        endMs: 48000,
        text: "I goed home.",
        eligible: true,
      },
      {
        id: "u2-repeat",
        speakerId: "classmate",
        startMs: 60000,
        endMs: 68000,
        text: "She go yesterday.",
        eligible: true,
      },
      {
        id: "overlap",
        speakerId: "learner",
        startMs: 19000,
        endMs: 22000,
        text: "I overlap wrong.",
        eligible: false,
      },
    ],
    embeddings: [
      { speakerId: "learner", vector: [1, ...Array<number>(15).fill(0)] },
      { speakerId: "classmate", vector: [0, 1, ...Array<number>(14).fill(0)] },
    ],
  };
  const analysis = await saveVoiceAnalysis(db, x.ctx, input, now);
  await saveVoiceCandidateMistakes(
    db,
    x.ctx,
    {
      analysisId: analysis.id,
      profileVersion: enrollment.version,
      mistakes: {
        learner: [
          {
            utteranceId: "u1",
            said: "I **goed** home.",
            correct: "I went home.",
            whyFa: "گذشتهٔ فعل go برابر went است.",
            kind: "grammar",
            teacherCorrected: false,
          },
        ],
        classmate: [
          {
            utteranceId: "u2",
            said: "She **go** yesterday.",
            correct: "She went yesterday.",
            whyFa: "برای دیروز فعل گذشته می‌آید.",
            kind: "grammar",
            teacherCorrected: false,
          },
        ],
      },
    },
    now,
  );
  return { ...x, source, sourceVersion: version, analysis, input, now };
}
