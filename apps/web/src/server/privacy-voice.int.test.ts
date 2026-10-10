import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getHtmlExport, htmlExportJob, requestHtmlExport } from "@recalino/core/html";
import { MemoryObjectStore } from "@recalino/core/plt";
import { changeVoiceIdentity, getVoiceEnrollment, saveVoiceSample } from "@recalino/core/voc";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { voiceFixture } from "../../../../packages/core/test/voice-fixture";
import { privacyDependencies } from "./privacy";

const store = new MemoryObjectStore();
vi.mock("./storage", () => ({ getObjectStore: () => store }));
vi.mock("./auth/supabase", () => ({ createAuthAdmin: () => ({ deleteUser: vi.fn() }) }));
const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
const exportSettings = {
  version: "privacy-voice-test",
  maxBytes: 1000000,
  maxItems: 1000,
  retentionSeconds: 3600,
};
const learnerVoice = [1, ...Array<number>(15).fill(0)];

/** A confirmed reference class, an automatic match in another class and an HTML export. */
async function fixture(automatic: boolean) {
  const x = await voiceFixture(db);
  const profile = await getVoiceEnrollment(db, x.ctx);
  await saveVoiceSample(db, new MemoryObjectStore(), x.ctx, {
    profileVersion: profile.version,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: x.input.modelVersion,
    embedding: learnerVoice,
  });
  const confirmed = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: 1,
    speakerId: "learner",
  });
  expect(confirmed.referenceStatus).toBe("added");
  const reference = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("id", "=", x.analysis.id)
    .executeTakeFirstOrThrow();
  const session = await db
    .selectFrom("org.class_session")
    .selectAll()
    .where("id", "=", x.session.id)
    .executeTakeFirstOrThrow();
  const laterSession = randomUUID();
  await db
    .insertInto("org.class_session")
    .values({ ...session, id: laterSession })
    .execute();
  const laterSource = await db
    .insertInto("src.asset")
    .values({ ...x.source, id: randomUUID(), operation_key: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const later = await db
    .insertInto("voc.analysis")
    .values({
      ...reference,
      id: randomUUID(),
      session_id: laterSession,
      source_id: laterSource.id,
      run_id: randomUUID(),
      verification_method: automatic ? "automatic" : "manual",
      reference_status: automatic ? null : reference.reference_status,
      candidates: JSON.stringify(reference.candidates),
      utterances: JSON.stringify(reference.utterances),
      mistakes: JSON.stringify(reference.mistakes),
      rejected_ids: JSON.stringify(reference.rejected_ids),
      private_embeddings: "[]",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const artifact = await requestHtmlExport(
    db,
    x.ctx,
    { revisionId: x.notebook.current.id, mediaIds: [] },
    { key: randomUUID(), settings: exportSettings },
  );
  await htmlExportJob(store).run(
    { userId: x.ctx.userId, artifactId: artifact.id },
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
  return { ...x, laterId: later.id, exportId: artifact.id };
}
function voiceHook() {
  const hook = privacyDependencies().hooks.find((entry) => entry.module === "voc");
  if (!hook) throw new Error("voc privacy hook is missing");
  return hook;
}
const method = (id: string) =>
  db
    .selectFrom("voc.analysis")
    .select(["status", "verification_method"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

it("VOICE-AC-09 deleting a reference class withdraws automatic matches and exports showing them", async () => {
  const x = await fixture(true);
  await db
    .transaction()
    .execute((tx) => voiceHook().tombstoneSession(tx, x.ctx, x.session.id, new Date()));
  expect(await method(x.laterId)).toEqual({ status: "unverified", verification_method: null });
  await expect(getHtmlExport(db, x.ctx, x.exportId)).rejects.toMatchObject({ code: "not_found" });

  const y = await fixture(true);
  await voiceHook().cleanupSource?.(db, y.ctx, y.source.id, [y.session.id], new Date());
  expect(await method(y.laterId)).toEqual({ status: "unverified", verification_method: null });
  await expect(getHtmlExport(db, y.ctx, y.exportId)).rejects.toMatchObject({ code: "not_found" });
});

it("keeps exports when deleting a class withdraws no automatic match", async () => {
  const x = await fixture(false);
  await voiceHook().cleanupSession(db, x.ctx, x.session.id, new Date());
  expect(await method(x.laterId)).toEqual({ status: "verified", verification_method: "manual" });
  expect((await getHtmlExport(db, x.ctx, x.exportId)).state).toBe("ready");
});
