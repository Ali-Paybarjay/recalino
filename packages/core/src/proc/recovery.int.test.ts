import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import {
  publishSourceRecoveryNotebook,
  readSourceRecoveryNotebook,
} from "../../test/source-recovery-fixture";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import type { AiProvider, ProviderResult, ProviderSettings, StructuredInput } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion, getVersion, publishKnowledgeVersion } from "../lkm";
import { getSession } from "../org";
import { type JobContext, MemoryObjectStore, sha256Hex, writeOwnedObject } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement, settleAllowance } from "../quota";
import {
  appendContentVersion,
  ownedSourceAvailability,
  selectSourceSnapshot,
  sourceContentVersions,
  updateSourceSelection,
} from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { prepareSourceExtractionRetry, readKnowledgeSourceSnapshot } from "./recovery";
import { createProcessingRun, getRun, listRuns } from "./runs";
import { getNoteSourceStatus } from "./source-issues";
import { processingJob } from "./worker";

// Recovery tests intentionally cannot inherit a cloud DATABASE_URL.
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-source-recovery",
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
};
class RecoveryProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  extractionCalls = 0;
  generationCalls = 0;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    const extraction = input.schemaName === "source_extraction";
    if (extraction) this.extractionCalls++;
    else this.generationCalls++;
    return {
      output: input.schema.parse(
        extraction
          ? {
              blocks: [{ id: "recovered", text: "Recovered source text." }],
              classification: { role: "class_material", confidence: "high" },
            }
          : { ...syntheticKnowledge(0), sourceClassifications: [] },
      ),
      requestId: randomUUID(),
      provider: this.name,
      model: input.model,
      actualMicros: 1,
      usage: {},
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("This fixture only extracts images");
  }
  async speech(): Promise<never> {
    throw new Error("Source recovery must not dispatch speech");
  }
}

async function fixture(options: { audio?: boolean; pdf?: boolean } = {}) {
  const x = await studyFixture(db);
  const store = new MemoryObjectStore();
  const provider = new RecoveryProvider();
  const job = processingJob({ provider, store });
  const assets: { id: string; contentVersionId: string; objectId: string }[] = [];
  for (const failed of [true, false]) {
    const audio = failed && options.audio;
    const pdf = failed && options.pdf;
    const mimeType = audio ? "audio/mpeg" : pdf ? "application/pdf" : "image/png";
    const bytes = new TextEncoder().encode(`Synthetic recovery image ${failed}`);
    const objectId = await writeOwnedObject(db, store, x.ctx, {
      module: "src",
      retention: "durable",
      contentType: mimeType,
      bytes,
      now: x.now,
    });
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: x.ctx.userId,
        kind: audio ? "audio" : pdf ? "pdf" : "image",
        declared_mime: mimeType,
        verified_mime: mimeType,
        duration_ms: audio ? 1000 : null,
        page_count: pdf ? 3 : null,
        size_bytes: bytes.length,
        sha256: sha256Hex(bytes),
        display_name: pdf ? "Lesson.pdf" : failed ? "Failed photo.png" : "Received photo.png",
        contract_version: "1",
        retention: audio ? "device_only" : "persistent",
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        original_object_id: audio ? null : objectId,
        verified_at: x.now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("src.session_source")
      .values({
        user_id: x.ctx.userId,
        session_id: x.session.id,
        asset_id: asset.id,
        role: audio ? "class_audio" : "class_material",
        selected: true,
      })
      .execute();
    const contentVersionId = await db.transaction().execute((tx) =>
      appendContentVersion(tx, x.ctx, asset.id, {
        originKey: `synthetic-recovery:${asset.id}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {
          ranges: [],
          sourceClassification: { role: "class_material", confidence: "high" },
        },
        units: [
          {
            id: "image-1",
            kind: pdf ? "page" : "document",
            start: pdf ? 2 : 1,
            status: audio ? "partial" : failed ? "failed" : "extracted",
            ...(failed
              ? {
                  reason: audio
                    ? "timestamps_unavailable"
                    : pdf
                      ? "unreadable"
                      : "unreadable_image",
                }
              : {}),
          },
        ],
        blocks: audio
          ? [
              {
                id: "untimed",
                kind: "transcript",
                unitId: "image-1",
                text: "Full usable transcript.",
              },
            ]
          : failed
            ? []
            : [{ id: "kept", kind: "paragraph", unitId: "image-1", text: "Kept source text." }],
      }),
    );
    assets.push({ id: asset.id, contentVersionId, objectId });
  }
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(x.now.getTime() - 1000),
    endsAt: new Date(x.now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic source retry verification",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-source-recovery",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic source retry verification" },
  );
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  const target = assets[0];
  if (!target) throw new Error("Missing synthetic target");
  const model = {
    ...syntheticKnowledge(0),
    coverage: { complete: false, missingSourceIds: [target.id] },
  };
  const knowledge = await db.transaction().execute(async (tx) => {
    const version = await publishKnowledgeVersion(tx, x.ctx, {
      runId: run.id,
      sessionId: x.session.id,
      sourcesVersion: snapshot.sourcesVersion,
      sourceFingerprint: snapshot.fingerprint,
      model,
      sources: snapshot.sources,
      explanationLanguage: "en",
      generation: { mode: "mock" },
    });
    await settleAllowance(tx, x.ctx, run.reservationId, amounts({}));
    await tx
      .updateTable("proc.processing_run")
      .set({ state: "partial_ready", output_version_id: version.id, finished_at: new Date() })
      .where("id", "=", run.id)
      .execute();
    return version;
  });
  const notebook = await publishSourceRecoveryNotebook(
    db,
    x.ctx,
    x.session.id,
    x.notebook.current.id,
    knowledge.id,
  );
  const pin = {
    sourceId: target.id,
    contentVersionId: target.contentVersionId,
    knowledgeVersionId: knowledge.id,
    expectedSourcesVersion: (await getSession(db, x.ctx, x.session.id)).sourcesVersion,
  };
  return { ...x, store, provider, job, assets, target, run, snapshot, knowledge, notebook, pin };
}

it("prepares only the pinned failed source, preserves notes and replays without another mutation or charge", async () => {
  const x = await fixture();
  const key = randomUUID();
  const before = await listRuns(db, x.ctx, x.session.id);
  const results = await Promise.all([
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key }),
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key }),
  ]);
  expect(results[1]).toEqual(results[0]);
  expect(results[0]?.sourcesVersion).toBe(x.pin.expectedSourcesVersion + 1);
  const next = await selectSourceSnapshot(db, x.ctx, x.session.id);
  expect(
    next.sources.find((source) => source.sourceId === x.target.id)?.contentVersionId,
  ).toBeNull();
  expect(next.sources.find((source) => source.sourceId === x.assets[1]?.id)?.contentVersionId).toBe(
    x.assets[1]?.contentVersionId,
  );
  expect(await listRuns(db, x.ctx, x.session.id)).toEqual(before);
  expect(await readSourceRecoveryNotebook(db, x.ctx, x.session.id)).toEqual(x.notebook);
  expect((await getVersion(db, x.ctx, x.knowledge.id)).model).toEqual(x.knowledge.model);
  expect(await sourceContentVersions(db, x.ctx, x.target.id)).toHaveLength(1);
  expect(x.provider.extractionCalls + x.provider.generationCalls).toBe(0);
});

it("a confirmed later run extracts the failed original instead of reusing its unreadable cache", async () => {
  const x = await fixture();
  await prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider: x.provider, job: x.job },
  );
  const context = (): JobContext => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });
  await x.job.run({ runId: run.id, userId: x.ctx.userId }, context());
  await x.job.run({ runId: run.id, userId: x.ctx.userId }, context());
  expect((await getRun(db, x.ctx, run.id)).state).toBe("ready");
  expect(x.provider.extractionCalls).toBe(1);
  expect(x.provider.generationCalls).toBe(1);
  expect((await getLatestVersion(db, x.ctx, x.session.id))?.model.coverage.complete).toBe(true);
  expect((await readSourceRecoveryNotebook(db, x.ctx, x.session.id))?.current).toEqual(
    x.notebook.current,
  );
});

it("reads completed extraction checkpoints instead of the pre-extraction input snapshot", async () => {
  const x = await fixture();
  const source = x.snapshot.sources.find((value) => value.sourceId === x.target.id);
  if (!source) throw new Error("Missing fixture source");
  await db
    .insertInto("proc.run_step")
    .values({ run_id: x.run.id, step: `source:${source.sourceId}`, output: JSON.stringify(source) })
    .execute();
  await db
    .updateTable("proc.processing_run")
    .set({
      input_snapshot: JSON.stringify({
        ...x.snapshot,
        sources: x.snapshot.sources.map((value) =>
          value.sourceId === source.sourceId
            ? { ...value, contentVersionId: null, units: [], blocks: [] }
            : value,
        ),
      }),
    })
    .where("id", "=", x.run.id)
    .execute();
  const result = await readKnowledgeSourceSnapshot(db, x.ctx, x.knowledge.id);
  expect(result.sources.find((value) => value.sourceId === source.sourceId)).toEqual(source);
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).resolves.toMatchObject({ sourceId: source.sourceId });
});

it("rejects foreign, stale and fabricated pins before clearing an extraction", async () => {
  const x = await fixture();
  const foreign = await studyFixture(db);
  await expect(
    prepareSourceExtractionRetry(db, foreign.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    prepareSourceExtractionRetry(
      db,
      x.ctx,
      x.session.id,
      { ...x.pin, contentVersionId: randomUUID() },
      { key: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await updateSourceSelection(db, x.ctx, x.session.id, x.target.id, {
    role: "class_material",
    selected: false,
    ranges: [],
    timeStatus: "unknown",
    contentVersionId: x.target.contentVersionId,
  });
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  const link = await db
    .selectFrom("src.session_source")
    .select("selected_content_version_id")
    .where("asset_id", "=", x.target.id)
    .executeTakeFirstOrThrow();
  expect(link.selected_content_version_id).toBe(x.target.contentVersionId);
});

it("rejects absent originals and active runs while retaining the usable extraction", async () => {
  const x = await fixture();
  await db
    .updateTable("src.asset")
    .set({ original_deleted_at: new Date() })
    .where("id", "=", x.target.id)
    .execute();
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { source: ["original_unavailable"] } },
  });
  await db
    .updateTable("src.asset")
    .set({ original_deleted_at: null })
    .where("id", "=", x.target.id)
    .execute();
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", x.run.id)
    .execute();
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await sourceContentVersions(db, x.ctx, x.target.id)).toHaveLength(1);
});

it("retains untimed audio text when its temporary original is absent and only prepares retry after bytes are restored", async () => {
  const x = await fixture({ audio: true });
  expect(await ownedSourceAvailability(db, x.ctx, [x.target.id])).toEqual([
    expect.objectContaining({ originalAvailable: false }),
  ]);
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { source: ["original_unavailable"] } },
  });
  const available = sourceSnapshotSchema.parse(await selectSourceSnapshot(db, x.ctx, x.session.id));
  expect(available.sources.find((source) => source.sourceId === x.target.id)?.blocks[0]?.text).toBe(
    "Full usable transcript.",
  );
  await db
    .insertInto("src.audio_upload")
    .values({
      user_id: x.ctx.userId,
      asset_id: x.target.id,
      object_id: x.target.objectId,
      reservation_id: x.run.reservationId,
      state: "verified",
      actual_duration_ms: 1000,
      expires_at: new Date(Date.now() + 3600000),
    })
    .execute();
  expect(await ownedSourceAvailability(db, x.ctx, [x.target.id])).toEqual([
    expect.objectContaining({ originalAvailable: true }),
  ]);
  expect(
    await ownedSourceAvailability(db, x.ctx, [x.target.id], new Date(Date.now() + 2 * 3600000)),
  ).toEqual([expect.objectContaining({ originalAvailable: false })]);
  await expect(
    prepareSourceExtractionRetry(db, x.ctx, x.session.id, x.pin, { key: randomUUID() }),
  ).resolves.toMatchObject({ sourceId: x.target.id });
  const next = await selectSourceSnapshot(db, x.ctx, x.session.id);
  const audio = next.sources.find((source) => source.sourceId === x.target.id);
  expect(audio?.contentVersionId).toBeNull();
  expect(audio?.objectId).toBe(x.target.objectId);
  expect((await sourceContentVersions(db, x.ctx, x.target.id))[0]?.blocks).toEqual(
    available.sources.find((source) => source.sourceId === x.target.id)?.blocks,
  );
  expect(x.provider.extractionCalls + x.provider.generationCalls).toBe(0);
});

it("reports a PDF's exact saved page and filename even after a newer extraction replaces the selected content", async () => {
  const x = await fixture({ pdf: true });
  const source = x.snapshot.sources.find((value) => value.sourceId === x.target.id);
  if (!source) throw new Error("Missing fixture source");
  await db
    .insertInto("proc.run_step")
    .values({ run_id: x.run.id, step: `source:${source.sourceId}`, output: JSON.stringify(source) })
    .execute();
  await db
    .updateTable("proc.processing_run")
    .set({
      input_snapshot: JSON.stringify({
        ...x.snapshot,
        sources: x.snapshot.sources.map((value) =>
          value.sourceId === source.sourceId
            ? { ...value, contentVersionId: null, units: [], blocks: [] }
            : value,
        ),
      }),
    })
    .where("id", "=", x.run.id)
    .execute();
  const before = await getNoteSourceStatus(db, x.ctx, x.session.id, x.knowledge.id);
  expect(before.issues).toEqual([
    expect.objectContaining({
      sourceId: x.target.id,
      name: "Lesson.pdf",
      order: 1,
      locator: "Page 2",
      kind: "extraction",
      action: "retry",
      recovery: x.pin,
    }),
  ]);
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, x.target.id, {
      originKey: randomUUID(),
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "page-2", kind: "page", start: 2, status: "extracted" }],
      blocks: [{ id: "now-readable", kind: "paragraph", unitId: "page-2", text: "New extraction" }],
    }),
  );
  const after = await getNoteSourceStatus(db, x.ctx, x.session.id, x.knowledge.id);
  expect(after.issues).toEqual([
    expect.objectContaining({
      sourceId: x.target.id,
      name: "Lesson.pdf",
      locator: "Page 2",
      kind: "extraction",
      action: "review",
    }),
  ]);
  expect(after.issues[0]?.recovery).toBeUndefined();
  expect((await getVersion(db, x.ctx, x.knowledge.id)).model.coverage.complete).toBe(false);
});
