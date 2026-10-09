import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getHtmlExport, htmlExportJob, requestHtmlExport } from "@recalino/core/html";
import { MemoryObjectStore } from "@recalino/core/plt";
import { getVoiceEnrollment } from "@recalino/core/voc";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { voiceFixture } from "../../../../packages/core/test/voice-fixture";

const mocks = vi.hoisted(() => ({
  store: null as MemoryObjectStore | null,
  diarize: vi.fn(),
  decode: vi.fn(),
}));
vi.mock("./storage", () => ({ getObjectStore: () => mocks.store }));
vi.mock("./voice-engine", () => ({
  VOICE_MODEL_REVISION: "synthetic-route-test",
  loadVoiceEngine: async () => ({ modelRevision: "synthetic-route-test", diarize: mocks.diarize }),
}));
vi.mock("./audio-preparer", () => ({ decodeVoiceAudio: mocks.decode }));

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const exportSettings = {
  version: "voice-enrollment-test",
  maxBytes: 1000000,
  maxItems: 1000,
  retentionSeconds: 3600,
};
it("profile PUT performs acoustic work once and a retry after DELETE cannot restore consent", async () => {
  const { voiceProfileHandler } = await import("./voice-routes");
  const fixture = await voiceFixture(db);
  mocks.store = new MemoryObjectStore();
  mocks.decode.mockImplementation(async () => ({
    samples: new Float32Array(16000 * 30),
    sampleRate: 16000,
    durationMs: 30000,
  }));
  mocks.diarize.mockResolvedValue({
    segments: [{ speakerId: "one", startMs: 0, endMs: 30000 }],
    speakers: [
      { speakerId: "one", cleanSpeechMs: 30000, embedding: [1, ...Array<number>(15).fill(0)] },
    ],
  });
  const handler = voiceProfileHandler(),
    key = randomUUID();
  const payload = {
    consent: true,
    consentVersion: "voice-v1",
    expectedVersion: fixture.input.profileVersion,
    audioBase64: Buffer.from("synthetic test sample").toString("base64"),
    mimeType: "audio/wav",
  };
  function call(method: string, requestKey: string, input?: unknown) {
    return handler({
      db,
      ctx: { ...fixture.ctx, route: "voiceProfile" },
      input,
      request: new Request("http://localhost/api/me/voice", {
        method,
        headers: { "Idempotency-Key": requestKey },
      }),
    });
  }
  expect((await call("PUT", key, payload)).body).toMatchObject({ enabled: true, enrolled: true });
  expect((await call("PUT", key, payload)).body).toMatchObject({ enabled: true, enrolled: true });
  expect(mocks.decode).toHaveBeenCalledTimes(1);
  expect(mocks.diarize).toHaveBeenCalledTimes(1);
  expect((await call("DELETE", randomUUID())).body).toMatchObject({
    enabled: false,
    enrolled: false,
  });
  await expect(call("PUT", key, payload)).rejects.toMatchObject({ code: "validation_failed" });
  expect(mocks.diarize).toHaveBeenCalledTimes(1);
  expect((await call("GET", randomUUID())).body).toMatchObject({ enabled: false });
});

it("VOICE-AC-09 replacing the sample withdraws automatic matches and the exports that showed them", async () => {
  const { voiceProfileHandler } = await import("./voice-routes");
  const fixture = await voiceFixture(db);
  mocks.store = new MemoryObjectStore();
  mocks.decode.mockImplementation(async () => ({
    samples: new Float32Array(16000 * 30),
    sampleRate: 16000,
    durationMs: 30000,
  }));
  mocks.diarize.mockResolvedValue({
    segments: [{ speakerId: "one", startMs: 0, endMs: 30000 }],
    speakers: [
      { speakerId: "one", cleanSpeechMs: 30000, embedding: [1, ...Array<number>(15).fill(0)] },
    ],
  });
  const handler = voiceProfileHandler();
  async function replaceSample() {
    const profile = await getVoiceEnrollment(db, fixture.ctx);
    return handler({
      db,
      ctx: { ...fixture.ctx, route: "voiceProfile" },
      input: {
        consent: true,
        consentVersion: "voice-v1",
        expectedVersion: profile.version,
        audioBase64: Buffer.from("synthetic test sample").toString("base64"),
        mimeType: "audio/wav",
      },
      request: new Request("http://localhost/api/me/voice", {
        method: "PUT",
        headers: { "Idempotency-Key": randomUUID() },
      }),
    });
  }
  async function exportNotebook() {
    const artifact = await requestHtmlExport(
      db,
      fixture.ctx,
      { revisionId: fixture.notebook.current.id, mediaIds: [] },
      { key: randomUUID(), settings: exportSettings },
    );
    await htmlExportJob(mocks.store as MemoryObjectStore).run(
      { userId: fixture.ctx.userId, artifactId: artifact.id },
      {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async (_name, effect) => {
          await db.transaction().execute(effect);
          return "ran";
        },
      },
    );
    return artifact.id;
  }
  // An automatic match made before any sample rests on no sample, so the first one replaces
  // nothing: the match and the export showing it stay.
  await db
    .updateTable("voc.analysis")
    .set({ status: "verified", verified_speaker_id: "learner", verification_method: "automatic" })
    .where("id", "=", fixture.analysis.id)
    .execute();
  const kept = await exportNotebook();
  await replaceSample();
  expect((await getHtmlExport(db, fixture.ctx, kept)).state).toBe("ready");
  expect(
    await db
      .selectFrom("voc.analysis")
      .select("verification_method")
      .where("id", "=", fixture.analysis.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ verification_method: "automatic" });

  const shown = await exportNotebook();
  await replaceSample();
  await expect(getHtmlExport(db, fixture.ctx, shown)).rejects.toMatchObject({ code: "not_found" });
  expect(
    await db
      .selectFrom("voc.analysis")
      .select(["status", "verification_method", "reason"])
      .where("id", "=", fixture.analysis.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ status: "unverified", verification_method: null, reason: "voice_reference_revoked" });
});
