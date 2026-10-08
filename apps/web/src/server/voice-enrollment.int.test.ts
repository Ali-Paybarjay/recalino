import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { MemoryObjectStore } from "@recalino/core/plt";
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
