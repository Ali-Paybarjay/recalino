import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { voiceFixture } from "../../test/voice-fixture";
import { lockAccount } from "../acc";
import { createDatabase } from "../db";
import { MemoryObjectStore, readOwnedObject } from "../plt";
import {
  changeVoiceIdentity,
  findVoiceAnalysis,
  saveVoiceAnalysis,
  saveVoiceCandidateMistakes,
} from "./analysis";
import { removeSessionVoice, removeSourceVoice } from "./privacy";
import {
  cleanupVoiceSampleObjects,
  enableVoice,
  getVoiceEnrollment,
  revokeVoiceData,
  saveVoiceSample,
} from "./profile";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());

it("re-enabling before cleanup never preserves a revoked sample or retires a new one", async () => {
  const x = await voiceFixture(db),
    store = new MemoryObjectStore();
  const embedding = x.input.embeddings[0]?.vector;
  if (!embedding) throw new Error("fixture vector missing");
  await saveVoiceSample(db, store, x.ctx, {
    profileVersion: x.input.profileVersion,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: x.input.modelVersion,
    embedding,
  });
  const old = await db
    .selectFrom("voc.profile")
    .select("sample_object_id")
    .where("user_id", "=", x.ctx.userId)
    .executeTakeFirstOrThrow();
  if (!old.sample_object_id) throw new Error("fixture sample missing");
  await revokeVoiceData(db, x.ctx);
  const reenabled = await enableVoice(db, x.ctx, "voice-v1");
  await cleanupVoiceSampleObjects(db, store, x.ctx);
  await expect(readOwnedObject(db, store, x.ctx, old.sample_object_id)).rejects.toMatchObject({
    code: "not_found",
  });
  await saveVoiceSample(db, store, x.ctx, {
    profileVersion: reenabled.version,
    bytes: new Uint8Array([4, 5, 6]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: x.input.modelVersion,
    embedding,
  });
  const current = await db
    .selectFrom("voc.profile")
    .select("sample_object_id")
    .where("user_id", "=", x.ctx.userId)
    .executeTakeFirstOrThrow();
  if (!current.sample_object_id) throw new Error("replacement sample missing");
  await cleanupVoiceSampleObjects(db, store, x.ctx);
  expect(await readOwnedObject(db, store, x.ctx, current.sample_object_id)).toEqual(
    new Uint8Array([4, 5, 6]),
  );
  expect(
    (
      await db
        .selectFrom("voc.sample_object")
        .select("retired_at")
        .where("object_id", "=", current.sample_object_id)
        .executeTakeFirstOrThrow()
    ).retired_at,
  ).toBeNull();
});

it("retains the original sample separately from the latest four confirmed lesson vectors", async () => {
  const x = await voiceFixture(db);
  const sampleVector = x.input.embeddings[0]?.vector;
  if (!sampleVector) throw new Error("fixture vector missing");
  await saveVoiceSample(db, new MemoryObjectStore(), x.ctx, {
    profileVersion: x.input.profileVersion,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: x.input.modelVersion,
    embedding: sampleVector,
  });
  const sample = (await getVoiceEnrollment(db, x.ctx)).embeddings.find(
    (entry) => entry.analysisId === null,
  );
  const confirmedIds: string[] = [];
  for (let index = 0; index < 6; index++) {
    const analysis =
      index === 0
        ? x.analysis
        : await saveVoiceAnalysis(
            db,
            x.ctx,
            { ...x.input, runId: randomUUID() },
            new Date(x.now.getTime() + index * 1000),
          );
    await changeVoiceIdentity(db, x.ctx, x.session.id, {
      action: "confirm",
      analysisId: analysis.id,
      expectedVersion: 1,
      speakerId: "learner",
    });
    confirmedIds.push(analysis.id);
  }
  const retained = await getVoiceEnrollment(db, x.ctx);
  expect(retained.embeddings).toHaveLength(5);
  expect(retained.embeddings.find((entry) => entry.analysisId === null)).toEqual(sample);
  expect(
    retained.embeddings.filter((entry) => entry.analysisId).map((entry) => entry.analysisId),
  ).toEqual(confirmedIds.slice(-4).reverse());
});

it("discards all temporary biometric vectors after a calibrated automatic acceptance", async () => {
  const x = await voiceFixture(db);
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  const session = await db
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "=", x.session.id)
    .executeTakeFirstOrThrow();
  const analysis = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("id", "=", x.analysis.id)
    .executeTakeFirstOrThrow();
  // Twenty independent lessons with manually labelled genuine/impostor score observations.
  for (let index = 0; index < 20; index++) {
    const sessionId = randomUUID(),
      analysisId = randomUUID();
    await db
      .insertInto("org.class_session")
      .values({ ...session, id: sessionId })
      .execute();
    await db
      .insertInto("voc.analysis")
      .values({
        ...analysis,
        id: analysisId,
        session_id: sessionId,
        run_id: randomUUID(),
        candidates: JSON.stringify(analysis.candidates),
        utterances: JSON.stringify(analysis.utterances),
        mistakes: JSON.stringify(analysis.mistakes),
        rejected_ids: JSON.stringify(analysis.rejected_ids),
        private_embeddings: "[]",
      })
      .execute();
    await db
      .insertInto("voc.feedback")
      .values([
        {
          user_id: x.ctx.userId,
          analysis_id: analysisId,
          model_version: x.input.modelVersion,
          speaker_id: "learner",
          score: 0.9,
          margin: 0.3,
          accepted: true,
        },
        {
          user_id: x.ctx.userId,
          analysis_id: analysisId,
          model_version: x.input.modelVersion,
          speaker_id: "classmate",
          score: 0.1,
          margin: 0,
          accepted: false,
        },
      ])
      .execute();
  }
  const accepted = await saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() });
  expect(accepted.status).toBe("verified");
  const saved = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("id", "=", accepted.id)
    .executeTakeFirstOrThrow();
  expect(saved.verification_method).toBe("automatic");
  expect(saved.private_embeddings).toEqual([]);
  expect(accepted.candidates).toHaveLength(2);
  expect(accepted.candidates[0]?.clips.length).toBeGreaterThan(0);
});

it("preserves a repeated confirmation and withdraws derived automatic trust on revocation", async () => {
  const x = await voiceFixture(db);
  const first = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  const enrolled = await getVoiceEnrollment(db, x.ctx);
  const again = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: first.version,
    speakerId: "learner",
  });
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toEqual(enrolled.embeddings);
  await expect(
    changeVoiceIdentity(db, x.ctx, x.session.id, {
      action: "confirm",
      analysisId: x.analysis.id,
      expectedVersion: again.version,
      speakerId: "classmate",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  const automatic = await saveVoiceAnalysis(
    db,
    x.ctx,
    { ...x.input, runId: randomUUID() },
    new Date(x.now.getTime() - 2000),
  );
  const manual = await saveVoiceAnalysis(
    db,
    x.ctx,
    { ...x.input, runId: randomUUID() },
    new Date(x.now.getTime() - 3000),
  );
  for (const [analysis, method] of [
    [automatic, "automatic"],
    [manual, "manual"],
  ] as const)
    await db
      .updateTable("voc.analysis")
      .set({ status: "verified", verification_method: method, verified_speaker_id: "learner" })
      .where("id", "=", analysis.id)
      .execute();
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "revoke",
    analysisId: x.analysis.id,
    expectedVersion: again.version,
  });
  const changed = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("id", "=", automatic.id)
    .executeTakeFirstOrThrow();
  expect(changed).toMatchObject({
    status: "unverified",
    verified_speaker_id: null,
    verification_method: null,
    candidate_id: "learner",
    version: 2,
    reason: "voice_reference_revoked",
  });
  expect(
    (
      await db
        .selectFrom("voc.analysis")
        .select("status")
        .where("id", "=", manual.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe("verified");
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toEqual([]);
});

it("none remains empty when an older correction request finishes afterwards", async () => {
  const x = await voiceFixture(db);
  const before = await findVoiceAnalysis(db, x.ctx, x.input);
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "none",
    analysisId: x.analysis.id,
    expectedVersion: 1,
  });
  await saveVoiceCandidateMistakes(db, x.ctx, {
    analysisId: x.analysis.id,
    profileVersion: x.input.profileVersion,
    mistakes: before?.mistakes ?? {},
  });
  expect((await findVoiceAnalysis(db, x.ctx, x.input))?.mistakes).toEqual({});
});

for (const scope of ["session", "source"] as const) {
  it(`${scope} cleanup waits for enrollment and preserves the newly committed sample vector`, async () => {
    const x = await voiceFixture(db);
    await changeVoiceIdentity(db, x.ctx, x.session.id, {
      action: "confirm",
      analysisId: x.analysis.id,
      expectedVersion: 1,
      speakerId: "learner",
    });
    const replacement = {
      vector: [0, 1, ...Array<number>(14).fill(0)],
      analysisId: null,
      modelVersion: "new-sample-model",
      createdAt: new Date().toISOString(),
    };
    let cleanup: Promise<void> | undefined;
    let finished = false;
    await db.transaction().execute(async (tx) => {
      await lockAccount(tx, x.ctx.userId);
      cleanup = (
        scope === "session"
          ? removeSessionVoice(db, x.ctx, x.session.id)
          : removeSourceVoice(db, x.ctx, x.source.id)
      ).then(() => {
        finished = true;
      });
      await new Promise<void>((accept) => setTimeout(accept, 50));
      expect(finished).toBe(false);
      await tx
        .updateTable("voc.profile")
        .set({
          embeddings: JSON.stringify([
            ...(await getVoiceEnrollment(tx, x.ctx)).embeddings,
            replacement,
          ]),
          model_version: replacement.modelVersion,
        })
        .where("user_id", "=", x.ctx.userId)
        .execute();
    });
    await cleanup;
    expect(await getVoiceEnrollment(db, x.ctx)).toMatchObject({
      embeddings: [replacement],
      modelVersion: replacement.modelVersion,
    });
  });
}
