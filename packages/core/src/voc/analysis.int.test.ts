import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { voiceFixture } from "../../test/voice-fixture";
import { createDatabase } from "../db";
import { renderClassNotesHtml } from "../lkm";
import { MemoryObjectStore, readOwnedObject } from "../plt";
import {
  changeVoiceIdentity,
  findVoiceAnalysis,
  getClassVoice,
  saveVoiceAnalysis,
  saveVoiceCandidateMistakes,
} from "./analysis";
import { expireVoiceEmbeddings, removeSessionVoice } from "./privacy";
import {
  cleanupVoiceSampleObjects,
  enableVoice,
  getVoiceEnrollment,
  getVoiceProfile,
  revokeVoiceData,
  saveVoiceSample,
} from "./profile";
import { projectVerifiedSpeech } from "./projection";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
it("Part6: hidden suggestions reveal only for the confirmed voice; reject and stale writes cannot leak another speaker", async () => {
  const x = await voiceFixture(db),
    model = referenceStudyModel();
  const before = await projectVerifiedSpeech(db, x.ctx, x.session.id, model);
  expect(renderClassNotesHtml(before)).not.toContain("I went home.");
  const confirmed = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  const visible = renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model));
  expect(visible).toContain("I went home.");
  expect(visible).not.toContain("She went yesterday.");
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toHaveLength(1);
  expect(
    (
      await db
        .selectFrom("voc.analysis")
        .select("private_embeddings")
        .where("id", "=", x.analysis.id)
        .executeTakeFirstOrThrow()
    ).private_embeddings,
  ).toEqual([]);
  const rejected = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "revoke",
    analysisId: x.analysis.id,
    expectedVersion: confirmed.version,
  });
  expect(rejected.candidates.map((item) => item.id)).not.toContain("learner");
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).not.toContain("I went home.");
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toEqual([]);
  await expect(
    changeVoiceIdentity(db, x.ctx, x.session.id, {
      action: "confirm",
      analysisId: x.analysis.id,
      expectedVersion: 1,
      speakerId: "learner",
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: rejected.version,
    speakerId: "classmate",
  });
  const selected = renderClassNotesHtml(
    await projectVerifiedSpeech(db, x.ctx, x.session.id, model),
  );
  expect(selected).toContain("She went yesterday.");
  expect(selected).not.toContain("I went home.");
});
it("Part6: deleting voice data removes the retained sample, learned prints, feedback and every projected speech assertion", async () => {
  const x = await voiceFixture(db),
    store = new MemoryObjectStore();
  const embedding = x.input.embeddings[0]?.vector;
  if (!embedding) throw new Error("fixture");
  await saveVoiceSample(db, store, x.ctx, {
    profileVersion: x.input.profileVersion,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: "synthetic-voice-v1",
    embedding,
  });
  const sample = (
    await db
      .selectFrom("voc.profile")
      .select("sample_object_id")
      .where("user_id", "=", x.ctx.userId)
      .executeTakeFirstOrThrow()
  ).sample_object_id;
  if (!sample) throw new Error("fixture");
  expect((await readOwnedObject(db, store, x.ctx, sample)).length).toBe(3);
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  await revokeVoiceData(db, x.ctx);
  await cleanupVoiceSampleObjects(db, store, x.ctx);
  expect(await getVoiceProfile(db, x.ctx)).toMatchObject({
    enabled: false,
    enrolled: false,
    sampleDurationMs: null,
    confirmedLessons: 0,
  });
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses).toEqual([]);
  await expect(readOwnedObject(db, store, x.ctx, sample)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() }),
  ).rejects.toMatchObject({ code: "conflict" });
  await enableVoice(db, x.ctx, "voice-v1");
  await expect(
    saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(
    renderClassNotesHtml(
      await projectVerifiedSpeech(db, x.ctx, x.session.id, referenceStudyModel()),
    ),
  ).not.toContain("I went home.");
});
it("Part6: invalid quotes and overlapping utterances never become evidence; temporary other-speaker vectors expire", async () => {
  const x = await voiceFixture(db);
  await saveVoiceCandidateMistakes(db, x.ctx, {
    analysisId: x.analysis.id,
    profileVersion: x.input.profileVersion,
    mistakes: {
      learner: [
        {
          utteranceId: "u1",
          said: "Invented personal sentence.",
          correct: "Changed sentence.",
          whyFa: "توضیح",
          kind: "grammar",
          teacherCorrected: false,
        },
        {
          utteranceId: "overlap",
          said: "I overlap wrong.",
          correct: "I am correct.",
          whyFa: "توضیح",
          kind: "grammar",
          teacherCorrected: false,
        },
      ],
    },
  });
  const found = await findVoiceAnalysis(db, x.ctx, x.input);
  expect(found?.mistakes.learner).toEqual([]);
  await expireVoiceEmbeddings(db, new Date(x.now.getTime() + 86400001));
  expect(
    (
      await db
        .selectFrom("voc.analysis")
        .select("private_embeddings")
        .where("id", "=", x.analysis.id)
        .executeTakeFirstOrThrow()
    ).private_embeddings,
  ).toEqual([]);
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toEqual([]);
  await removeSessionVoice(db, x.ctx, x.session.id);
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses).toEqual([]);
});
it("Part6: another account cannot read, confirm or write a voice analysis", async () => {
  const [x, y] = await Promise.all([voiceFixture(db), voiceFixture(db)]);
  await expect(getClassVoice(db, y.ctx, x.session.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(
    changeVoiceIdentity(db, y.ctx, y.session.id, {
      action: "confirm",
      analysisId: x.analysis.id,
      expectedVersion: 1,
      speakerId: "learner",
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    saveVoiceCandidateMistakes(db, y.ctx, {
      analysisId: x.analysis.id,
      profileVersion: 1,
      mistakes: {},
    }),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("Part6: repeated patterns include only currently authorized writing and speech and disappear on revocation", async () => {
  const x = await voiceFixture(db),
    model = referenceStudyModel();
  if (!model.classNotes) throw new Error("fixture");
  model.classNotes.mistakes = {
    speechStatus: "unverified",
    patterns: [],
    items: [
      {
        source: "handwriting",
        said: "I buyed it.",
        correct: "I bought it.",
        whyFa: "گذشتهٔ فعل را به کار ببر.",
        kind: "grammar",
        teacherCorrected: false,
      },
    ],
  };
  expect(
    (await projectVerifiedSpeech(db, x.ctx, x.session.id, model)).classNotes?.mistakes?.patterns,
  ).toEqual([]);
  const confirmed = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  const visible = await projectVerifiedSpeech(db, x.ctx, x.session.id, model);
  expect(visible.classNotes?.mistakes?.patterns).toMatchObject([{ count: 2 }]);
  expect(renderClassNotesHtml(visible)).toContain("گرامر · ۲ بار");
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "revoke",
    analysisId: x.analysis.id,
    expectedVersion: confirmed.version,
  });
  const revoked = await projectVerifiedSpeech(db, x.ctx, x.session.id, visible);
  expect(revoked.classNotes?.mistakes?.patterns).toEqual([]);
  expect(renderClassNotesHtml(revoked)).not.toContain("I went home.");
});
