import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import type { AiProvider } from "../aip";
import { createDatabase } from "../db";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore, sha256Hex } from "../plt";
import { amounts, grantEntitlement, reservationIsOpen } from "../quota";
import {
  acceptSourceNotice,
  beginTemporaryAudioUpload,
  createSource,
  selectSourceSnapshot,
  temporaryAudioPartLink,
  updateSourceSelection,
  verifyTemporaryAudio,
} from "../src";
import { activateProcessingRun, createProcessingRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());

async function activationFixture(
  durationMs: number,
  ranges: { start: number; end: number }[] = [],
) {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 100, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic verified audio activation tests",
  });
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic activation.mp3",
    durationMs,
    parts: [],
    operationKey: randomUUID(),
  });
  const selection = {
    role: "class_audio",
    selected: true,
    ranges,
    timeStatus: "unknown",
    contentVersionId: null,
  };
  await updateSourceSelection(db, x.ctx, x.session.id, source.assetId, selection);
  const unavailable = async (): Promise<never> => {
    throw new Error("Synthetic activation never calls an AI provider");
  };
  const provider: AiProvider = {
    name: "synthetic",
    mode: "mock",
    settings: {
      version: "fixture",
      llmModel: "synthetic/llm",
      visionModel: "synthetic/vision",
      sttModel: "synthetic/stt",
      ttsModel: "synthetic/tts",
      voice: "synthetic",
      promptVersion: "1",
      maxInputCharacters: 10000,
      maxOutputTokens: 1000,
      timeoutMs: 1000,
      maximumMicros: 10,
      currency: "USD",
      priceVersion: "fixture",
      charactersPerPage: 1000,
      audioUrlSupported: false,
      sttProviderOptions: {},
      dataContractApproved: true,
    },
    structured: unavailable,
    transcribe: unavailable,
    speech: unavailable,
  };
  const store = new MemoryObjectStore();
  const job = processingJob({ store, provider });
  const snapshot = await selectSourceSnapshot(db, x.ctx, x.session.id);
  const run = await createProcessingRun(
    db,
    x.ctx,
    {
      sessionId: x.session.id,
      operationKey: randomUUID(),
      expectedFingerprint: snapshot.fingerprint,
      expectedSourcesVersion: snapshot.sourcesVersion,
    },
    { job, provider },
  );
  expect(run.state).toBe("awaiting_upload");
  const upload = await beginTemporaryAudioUpload(db, x.ctx, source.assetId, {
    reservationId: run.reservationId,
    parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
  });
  const link = await temporaryAudioPartLink(
    db,
    store,
    x.ctx,
    source.assetId,
    upload.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "audio/mpeg")).toBe(200);
  async function verify(actualDurationMs: number) {
    return verifyTemporaryAudio(db, store, x.ctx, source.assetId, upload.uploadId, {
      inspect: async () => ({ durationMs: actualDurationMs, audioOnly: true }),
    });
  }
  return { ...x, source, selection, run, job, verify };
}
it("activates verified audio with a 120 ms same-second duration difference without increasing its hold", async () => {
  const x = await activationFixture(3763);
  await x.verify(3883);
  const activated = await activateProcessingRun(db, x.ctx, x.run.id, x.job);
  expect(activated.state).toBe("queued");
  expect(activated.selectionFingerprint).toBe(x.run.selectionFingerprint);
  const saved = await db
    .selectFrom("proc.processing_run")
    .select(["input_snapshot", "requested_amounts", "job_id"])
    .where("id", "=", x.run.id)
    .executeTakeFirstOrThrow();
  expect(saved.input_snapshot).toMatchObject({ sources: [{ durationMs: 3883 }] });
  expect(saved.requested_amounts).toEqual(amounts({ audio: 4, regeneration: 1 }));
  expect(saved.job_id).toBeTruthy();
  expect(
    await db
      .selectFrom("plt.job")
      .select(["kind", "state"])
      .where("id", "=", saved.job_id)
      .executeTakeFirst(),
  ).toEqual({ kind: "proc.process", state: "queued" });
  expect(await reservationIsOpen(db, x.ctx, x.run.reservationId)).toBe(true);
});
it("requires new confirmation when verified full-file audio exceeds the reserved seconds", async () => {
  const x = await activationFixture(3763);
  await x.verify(4001);
  await expect(activateProcessingRun(db, x.ctx, x.run.id, x.job)).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { quota: ["new_confirmation_required"] } },
  });
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select(["state", "job_id", "requested_amounts"])
      .where("id", "=", x.run.id)
      .executeTakeFirst(),
  ).toEqual({
    state: "awaiting_upload",
    job_id: null,
    requested_amounts: amounts({ audio: 4, regeneration: 1 }),
  });
});
it("still rejects a confirmed selection extending beyond the verified audio", async () => {
  const x = await activationFixture(4000, [{ start: 0, end: 4000 }]);
  await x.verify(3883);
  await expect(activateProcessingRun(db, x.ctx, x.run.id, x.job)).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { audio: ["new_confirmation_required"] } },
  });
});
it.each(["selection", "checksum"])(
  "still rejects a real %s change after processing confirmation",
  async (changed) => {
    const x = await activationFixture(3763);
    await x.verify(3883);
    if (changed === "selection")
      await updateSourceSelection(db, x.ctx, x.session.id, x.source.assetId, {
        ...x.selection,
        ranges: [{ start: 0, end: 1000 }],
      });
    else
      await db
        .updateTable("src.asset")
        .set({ sha256: "0".repeat(64) })
        .where("id", "=", x.source.assetId)
        .execute();
    await expect(activateProcessingRun(db, x.ctx, x.run.id, x.job)).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { sources: ["changed_after_confirmation"] } },
    });
    expect(
      await db
        .selectFrom("proc.processing_run")
        .select("job_id")
        .where("id", "=", x.run.id)
        .executeTakeFirst(),
    ).toEqual({ job_id: null });
  },
);
