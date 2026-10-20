import { randomUUID } from "node:crypto";
import type { AiProvider } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import { createSession, releaseCaptureLease, renewCaptureLease } from "@recalino/core/org";
import { MemoryObjectStore, sha256Hex } from "@recalino/core/plt";
import {
  listRuns,
  processingJob,
  requestAutomaticLearning,
  requestAutomaticProcessing,
} from "@recalino/core/proc";
import { amounts, configureCostPolicy, grantEntitlement } from "@recalino/core/quota";
import { appendContentVersion } from "@recalino/core/src";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { automaticLearningSync } from "./automatic-learning";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 2 });
afterAll(() => db.destroy());
const unavailable = async (): Promise<never> => {
  throw new Error("No provider call is expected while a capture lease is open");
};
const provider: AiProvider = {
  name: "synthetic",
  mode: "mock",
  settings: {
    version: "capture-lease-fixture",
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "1",
    maxInputCharacters: 10000,
    maxOutputTokens: 4000,
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

it("D60/D105: lesson work waits while a capture is open; after Stop it starts at the learner's press", async () => {
  const base = await studyFixture(db);
  const session = await createSession(db, base.ctx, {}, { key: randomUUID() });
  const now = new Date();
  await grantEntitlement(db, {
    userId: base.ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Local capture lease test",
  });
  await configureCostPolicy(
    db,
    {
      version: "capture-lease-fixture",
      currency: "USD",
      killSwitch: false,
      limits: { session: 1e8, userMonth: 1e8, systemDay: 1e8, systemMonth: 1e8 },
    },
    { actorId: "synthetic-operator", reason: "Local capture lease test" },
  );
  const name = "Synthetic handout added during class";
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: base.ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: name.length,
      sha256: sha256Hex(name),
      display_name: name,
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: base.ctx.userId,
      session_id: session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, base.ctx, asset.id, {
      originKey: randomUUID(),
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: name }],
    }),
  );
  await requestAutomaticLearning(db, base.ctx, session.id, { changed: true, now });
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const sync = () =>
    automaticLearningSync(db, base.ctx, session.id, {
      dependencies: { provider: () => provider, processing: () => job },
    });

  await renewCaptureLease(db, base.ctx, session.id);
  expect((await sync()).state).toBe("waiting_sources");
  expect(await listRuns(db, base.ctx, session.id)).toHaveLength(0);
  // D105: Process never stops a recording, so it is refused while the lease is open.
  await expect(requestAutomaticProcessing(db, base.ctx, session.id)).rejects.toMatchObject({
    code: "conflict",
    details: { fields: { session: ["capture_in_progress"] } },
  });

  await releaseCaptureLease(db, base.ctx, session.id);
  // D105: Stop ends the recording, not the session.
  expect(await sync()).toMatchObject({ processRequest: "not_requested", run: null });
  expect(await listRuns(db, base.ctx, session.id)).toHaveLength(0);
  await requestAutomaticProcessing(db, base.ctx, session.id);
  const after = await sync();
  expect(after.run).toBeTruthy();
  expect(await listRuns(db, base.ctx, session.id)).toHaveLength(1);
  // A requested session whose learner records again starts nothing more during the capture.
  await renewCaptureLease(db, base.ctx, session.id);
  expect((await sync()).state).toBe("waiting_sources");
  expect(await listRuns(db, base.ctx, session.id)).toHaveLength(1);
});
