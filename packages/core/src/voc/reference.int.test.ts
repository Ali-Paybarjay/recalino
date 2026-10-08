import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { voiceFixture } from "../../test/voice-fixture";
import { createDatabase } from "../db";
import { MemoryObjectStore } from "../plt";
import type { VoiceAcceptancePolicy } from "./policy";

// Synthetic policy for the fixture model only; production numbers come from tools/voice/evaluation.
const registry = vi.hoisted(() => ({ policy: null as VoiceAcceptancePolicy | null }));
vi.mock("./policy-registry", () => ({
  VOICE_ACCEPTANCE_POLICIES: [],
  voiceAcceptancePolicy: (modelVersion: string) =>
    registry.policy?.modelVersion === modelVersion ? registry.policy : null,
}));
// The account's own calibration (20 confirmed and 20 rejected classes) can be stood in for.
const account = vi.hoisted(() => ({ ready: false }));
vi.mock("./calibration", async (importOriginal) => {
  const real = await importOriginal<typeof import("./calibration")>();
  return {
    accountVoiceCalibration: async (...args: Parameters<typeof real.accountVoiceCalibration>) =>
      account.ready
        ? {
            calibration: {
              modelVersion: args[2],
              acceptScore: 0,
              minMargin: 0,
              positiveCount: 20,
              negativeCount: 20,
            },
            confirmedLessons: 21,
            rejectedScores: [],
          }
        : real.accountVoiceCalibration(...args),
  };
});
const { changeVoiceIdentity, getClassVoice, saveVoiceAnalysis } = await import("./analysis");
const { expireVoiceEmbeddings, removeSessionVoice } = await import("./privacy");
const { getVoiceEnrollment, getVoiceProfile, saveVoiceSample } = await import("./profile");

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const MODEL = "synthetic-voice-v1";
const learnerVoice = [1, ...Array<number>(15).fill(0)];
const classmateVoice = [0, 1, ...Array<number>(14).fill(0)];
beforeEach(() => {
  account.ready = false;
  registry.policy = {
    id: "integration-test-policy",
    modelVersion: MODEL,
    acceptScore: 0.7,
    minMargin: 0.1,
    referenceConsistency: 0.6,
    minCleanSpeechMs: 20000,
    autoAccept: true,
  };
});

type Fixture = Awaited<ReturnType<typeof voiceFixture>>;
async function sample(x: Fixture, embedding: number[]) {
  const profile = await getVoiceEnrollment(db, x.ctx);
  await saveVoiceSample(db, new MemoryObjectStore(), x.ctx, {
    profileVersion: profile.version,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: MODEL,
    embedding,
  });
}
async function confirmLearner(x: Fixture, analysisId = x.analysis.id, expectedVersion = 1) {
  return changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId,
    expectedVersion,
    speakerId: "learner",
  });
}
const row = (id: string) =>
  db.selectFrom("voc.analysis").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("VOICE-AC-03 FR-VOC-004: a confirmation states what it taught later matching", () => {
  it("adds a clear voice that matches the sample and shows the source by name", async () => {
    const x = await voiceFixture(db);
    expect((await row(x.analysis.id)).match_reason).toBe("no_sample");
    await sample(x, learnerVoice);
    const confirmed = await confirmLearner(x);
    expect(confirmed.referenceStatus).toBe("added");
    expect(
      (await getVoiceEnrollment(db, x.ctx)).embeddings.map((entry) => entry.analysisId),
    ).toEqual([x.analysis.id, null]);
    const view = (await getClassVoice(db, x.ctx, x.session.id)).analyses[0];
    expect(view?.referenceStatus).toBe("added");
    expect(view?.source).toEqual({
      name: "Synthetic classroom",
      durationMs: 90000,
      sizeBytes: 100,
      sha256: "a".repeat(64),
      mimeType: "audio/wav",
    });
  });

  it("keeps the learner's choice but not the reference when the voice is unlike the sample", async () => {
    const x = await voiceFixture(db);
    await sample(x, classmateVoice);
    const confirmed = await confirmLearner(x);
    expect(confirmed).toMatchObject({ status: "verified", referenceStatus: "mismatch" });
    expect(
      (await getVoiceEnrollment(db, x.ctx)).embeddings.map((entry) => entry.analysisId),
    ).toEqual([null]);
  });

  it("explains short, expired and missing voices, and clears the outcome on revoke", async () => {
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    const short = await saveVoiceAnalysis(db, x.ctx, {
      ...x.input,
      runId: randomUUID(),
      candidates: x.input.candidates.map((candidate) => ({ ...candidate, cleanSpeechMs: 12000 })),
    });
    expect((await confirmLearner(x, short.id, short.version)).referenceStatus).toBe("short");

    const y = await voiceFixture(db);
    await sample(y, learnerVoice);
    const later = new Date(Date.now() + 25 * 3600 * 1000);
    await expireVoiceEmbeddings(db, later);
    const expired = await changeVoiceIdentity(
      db,
      y.ctx,
      y.session.id,
      { action: "confirm", analysisId: y.analysis.id, expectedVersion: 1, speakerId: "learner" },
      later,
    );
    expect(expired.referenceStatus).toBe("expired");

    const z = await voiceFixture(db);
    await sample(z, learnerVoice);
    const missing = await saveVoiceAnalysis(db, z.ctx, {
      ...z.input,
      runId: randomUUID(),
      embeddings: [],
    });
    const confirmed = await confirmLearner(z, missing.id, missing.version);
    expect(confirmed.referenceStatus).toBe("missing");
    const revoked = await changeVoiceIdentity(db, z.ctx, z.session.id, {
      action: "revoke",
      analysisId: missing.id,
      expectedVersion: confirmed.version,
    });
    expect(revoked.referenceStatus).toBeNull();
  });
});

describe("VOICE-AC-04/05: later classes match automatically only under the evaluated policy", () => {
  it("accepts the next class after one sample and one confirmed class, without new references", async () => {
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    await confirmLearner(x);
    const later = await saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() });
    const saved = await row(later.id);
    expect(saved).toMatchObject({
      status: "verified",
      verification_method: "automatic",
      verified_speaker_id: "learner",
      match_reason: null,
      reference_status: null,
      private_embeddings: [],
    });
    // An automatic result is never a new reference.
    expect((await getVoiceEnrollment(db, x.ctx)).embeddings).toHaveLength(2);
    expect((await getVoiceProfile(db, x.ctx, true, MODEL)).readiness).toEqual({
      sample: true,
      references: 1,
      automatic: "ready",
    });
  });

  it("asks with a stated reason when the sample, the reference or the policy is missing", async () => {
    const x = await voiceFixture(db);
    expect((await getVoiceProfile(db, x.ctx, true, MODEL)).readiness?.automatic).toBe(
      "needs_sample",
    );
    await confirmLearner(x);
    const noSample = await saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() });
    expect(await row(noSample.id)).toMatchObject({
      status: "unverified",
      match_reason: "no_sample",
    });

    const y = await voiceFixture(db);
    await sample(y, learnerVoice);
    expect((await getVoiceProfile(db, y.ctx, true, MODEL)).readiness?.automatic).toBe(
      "needs_class",
    );
    const noReference = await saveVoiceAnalysis(db, y.ctx, { ...y.input, runId: randomUUID() });
    expect(await row(noReference.id)).toMatchObject({ match_reason: "no_reference" });

    const z = await voiceFixture(db);
    await sample(z, learnerVoice);
    await confirmLearner(z);
    if (registry.policy) registry.policy = { ...registry.policy, autoAccept: false };
    const off = await saveVoiceAnalysis(db, z.ctx, { ...z.input, runId: randomUUID() });
    expect(await row(off.id)).toMatchObject({
      status: "unverified",
      match_reason: "policy_unavailable",
    });
    expect((await getVoiceProfile(db, z.ctx, true, MODEL)).readiness?.automatic).toBe(
      "unavailable",
    );
  });

  it("keeps every class manual under an evaluated policy that turns automatic acceptance off", async () => {
    // A ready account calibration accepts on its own when the model revision has no policy.
    account.ready = true;
    registry.policy = null;
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    await confirmLearner(x);
    const legacy = await saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() });
    expect(await row(legacy.id)).toMatchObject({
      status: "verified",
      verification_method: "automatic",
    });
    // An evaluated entry replaces that calibration, so its switch also keeps it from accepting.
    registry.policy = {
      id: "integration-test-policy-off",
      modelVersion: MODEL,
      acceptScore: 0.7,
      minMargin: 0.1,
      referenceConsistency: 0.6,
      minCleanSpeechMs: 20000,
      autoAccept: false,
    };
    const y = await voiceFixture(db);
    await sample(y, learnerVoice);
    await confirmLearner(y);
    const off = await saveVoiceAnalysis(db, y.ctx, { ...y.input, runId: randomUUID() });
    expect(await row(off.id)).toMatchObject({
      status: "unverified",
      verification_method: null,
      match_reason: "policy_unavailable",
    });
  });

  it("asks when the two voices are alike or one voice has no voiceprint", async () => {
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    await confirmLearner(x);
    const alike = await saveVoiceAnalysis(db, x.ctx, {
      ...x.input,
      runId: randomUUID(),
      embeddings: [
        { speakerId: "learner", vector: learnerVoice },
        { speakerId: "classmate", vector: [0.95, Math.sqrt(1 - 0.95 ** 2), ...Array(14).fill(0)] },
      ],
    });
    expect(await row(alike.id)).toMatchObject({
      status: "unverified",
      match_reason: "similar_voices",
    });
    const lone = await saveVoiceAnalysis(db, x.ctx, {
      ...x.input,
      runId: randomUUID(),
      embeddings: [{ speakerId: "learner", vector: learnerVoice }],
    });
    expect(await row(lone.id)).toMatchObject({ status: "unverified", match_reason: "few_voices" });
  });
});

describe("VOICE-AC-09: withdrawn or replaced references withdraw automatic trust", () => {
  it("re-checks references against a new sample and asks again in automatic classes", async () => {
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    await confirmLearner(x);
    const later = await saveVoiceAnalysis(db, x.ctx, { ...x.input, runId: randomUUID() });
    expect((await row(later.id)).verification_method).toBe("automatic");
    await sample(x, classmateVoice);
    expect(await row(later.id)).toMatchObject({
      status: "unverified",
      verification_method: null,
      reason: "voice_reference_revoked",
    });
    expect(await row(x.analysis.id)).toMatchObject({ reference_status: "mismatch" });
    // A class analysed from sampled audio keeps saying so after it asks again.
    const y = await voiceFixture(db);
    await sample(y, learnerVoice);
    await confirmLearner(y);
    const sampled = await saveVoiceAnalysis(db, y.ctx, {
      ...y.input,
      runId: randomUUID(),
      reason: "sampled_audio",
    });
    expect((await row(sampled.id)).verification_method).toBe("automatic");
    await sample(y, learnerVoice);
    expect(await row(sampled.id)).toMatchObject({
      status: "unverified",
      reason: "voice_reference_revoked_sampled_audio",
    });
    expect(
      (await getVoiceEnrollment(db, x.ctx)).embeddings.map((entry) => entry.analysisId),
    ).toEqual([null]);
  });

  it("reports a reference later replaced, and deleting its class withdraws automatic matches", async () => {
    const x = await voiceFixture(db);
    await sample(x, learnerVoice);
    await confirmLearner(x);
    const reference = await row(x.analysis.id);
    const session = await db
      .selectFrom("org.class_session")
      .selectAll()
      .where("id", "=", x.session.id)
      .executeTakeFirstOrThrow();
    const otherSession = randomUUID();
    await db
      .insertInto("org.class_session")
      .values({ ...session, id: otherSession })
      .execute();
    const automatic = await db
      .insertInto("voc.analysis")
      .values({
        ...reference,
        id: randomUUID(),
        session_id: otherSession,
        run_id: randomUUID(),
        verification_method: "automatic",
        reference_status: null,
        candidates: JSON.stringify(reference.candidates),
        utterances: JSON.stringify(reference.utterances),
        mistakes: JSON.stringify(reference.mistakes),
        rejected_ids: JSON.stringify(reference.rejected_ids),
        private_embeddings: "[]",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    // The stored outcome stays truthful when the reference leaves the profile.
    await db
      .updateTable("voc.profile")
      .set({
        embeddings: JSON.stringify((await getVoiceEnrollment(db, x.ctx)).embeddings.slice(1)),
      })
      .where("user_id", "=", x.ctx.userId)
      .execute();
    expect((await getClassVoice(db, x.ctx, x.session.id)).analyses[0]?.referenceStatus).toBe(
      "retired",
    );
    // Restore the reference, then delete the class that supplied it.
    await db
      .updateTable("voc.profile")
      .set({
        embeddings: JSON.stringify([
          {
            vector: learnerVoice,
            modelVersion: MODEL,
            analysisId: x.analysis.id,
            createdAt: new Date().toISOString(),
          },
          ...(await getVoiceEnrollment(db, x.ctx)).embeddings,
        ]),
      })
      .where("user_id", "=", x.ctx.userId)
      .execute();
    await removeSessionVoice(db, x.ctx, x.session.id);
    expect(await row(automatic.id)).toMatchObject({
      status: "unverified",
      verification_method: null,
      reason: "voice_reference_revoked",
    });
  });
});
