import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  saveTeachingPreference,
  updateProfile,
} from "../acc";
import {
  type AiProvider,
  type EstimateRate,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  readEstimateRates,
  type StructuredInput,
  saveEstimateRates,
  type Transcript,
  type TranscriptionInput,
} from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion, type KnowledgeModel, listVersions } from "../lkm";
import { createSession, deleteSession } from "../org";
import { MemoryObjectStore, runDueJobs, writeOwnedObject } from "../plt";
import { allowance, amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion, readInputContract } from "../src";
import { expireAwaitingUploads } from "./maintenance";
import {
  cancelRun,
  cancelSessionRuns,
  cleanupSessionProcessing,
  createProcessingRun,
  getRun,
  listRuns,
  registerProcessingTemporaryObject,
  retryRun,
} from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
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
};
class FixtureProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  calls = 0;
  beforeResult?: () => Promise<void>;
  failure?: ProviderError;
  invalidEvidence = false;
  actualMicros: number | null = 1;
  prompts: string[] = [];
  inputs: unknown[] = [];
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls++;
    this.prompts.push(input.system);
    if (input.schemaName === "pdf_page_extraction")
      return {
        output: input.schema.parse({
          blocks: [{ id: "ocr-1", text: "Synthetic selected PDF text" }],
        }),
        requestId: "synthetic-ocr",
        model: input.model,
        provider: this.name,
        actualMicros: 1,
        usage: { pages: 1 },
      };
    this.inputs.push(JSON.parse(input.input));
    await this.beforeResult?.();
    if (this.failure) throw this.failure;
    const data = z
      .object({
        sources: z.array(
          z.object({
            sourceId: z.string(),
            contentVersionId: z.string(),
            blocks: z.array(z.object({ id: z.string(), text: z.string() })),
          }),
        ),
      })
      .parse(JSON.parse(input.input));
    const source = data.sources[0];
    const block = source?.blocks[0];
    if (!source || !block) throw new Error("Fixture expected nonempty selected source evidence");
    const model: KnowledgeModel = {
      schemaVersion: "1",
      title: "Synthetic class",
      language: { learning: "en", explanation: "en" },
      summary: [
        {
          id: "claim-1",
          text: "A synthetic class example.",
          origin: "from_class",
          creation: "ai_generation",
          evidence: "material",
          sourceRefs: [
            {
              sourceId: this.invalidEvidence ? randomUUID() : source.sourceId,
              contentVersionId: source.contentVersionId,
              locator: {
                kind: "text",
                blockId: block.id,
                start: 0,
                end: Array.from(block.text).length,
              },
            },
          ],
          speakerRole: "unknown",
          uncertain: false,
        },
      ],
      topics: [],
      learningItems: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    return {
      output: input.schema.parse(model),
      requestId: "synthetic-generation",
      model: input.model,
      provider: this.name,
      actualMicros: this.actualMicros,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(_input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    throw new Error("Fixture has no audio");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("Fixture has no speech");
  }
}
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  return ctx;
}
async function fixture(grant = true) {
  const ctx = await learner();
  const now = new Date();
  const session = await createSession(db, ctx, {}, { key: randomUUID() });
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 14,
      sha256: "a".repeat(64),
      display_name: "Synthetic.txt",
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: ctx.userId,
      session_id: session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, ctx, asset.id, {
      originKey: "fixture",
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Present perfect" }],
    }),
  );
  if (grant)
    await grantEntitlement(db, {
      userId: ctx.userId,
      startsAt: new Date(now.getTime() - 1000),
      endsAt: new Date(now.getTime() + 3600000),
      amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
      operationKey: randomUUID(),
      actorId: "synthetic-operator",
      reason: "Synthetic integration fixture",
    });
  await configureCostPolicy(
    db,
    {
      version: "fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic integration fixture" },
  );
  const provider = new FixtureProvider();
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const start = () =>
    createProcessingRun(
      db,
      ctx,
      { sessionId: session.id, operationKey: randomUUID() },
      { provider, job },
    );
  const work = () =>
    runDueJobs(db, [job], { kinds: [job.kind], deadline: new Date(Date.now() + 5000) });
  return { ctx, session, asset, provider, job, start, work };
}
describe("durable processing, atomic quota and provenance on Postgres", () => {
  it("snapshots estimate rates before provider dispatch while later attempts use the new revision and retain hard holds", async () => {
    const f = await fixture();
    const localAdmin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
    const operationKeys: [string, string] = [
      `processing-rates-1-${randomUUID()}`,
      `processing-rates-2-${randomUUID()}`,
    ];
    const previous = await readEstimateRates(db);
    const policy = await db.selectFrom("quota.cost_policy").selectAll().executeTakeFirstOrThrow();
    const rates = (inputRate: number, outputRate: number): EstimateRate[] => [
      {
        id: "synthetic-input-rate",
        stage: "generation",
        model: settings.llmModel,
        unit: "input_million_tokens",
        rateMicros: inputRate,
      },
      {
        id: "synthetic-output-rate",
        stage: "generation",
        model: settings.llmModel,
        unit: "output_million_tokens",
        rateMicros: outputRate,
      },
    ];
    const firstRates = rates(100000, 200000);
    const nextRates = rates(300000, 400000);
    try {
      const firstRevision = await saveEstimateRates(db, {
        rates: firstRates,
        operationKey: operationKeys[0],
        actorId: f.ctx.userId,
        reason: "Synthetic pre-dispatch rate snapshot verification",
      });
      f.provider.actualMicros = null;
      const firstRun = await f.start();
      let activeRunId = firstRun.id;
      let dispatches = 0;
      f.provider.beforeResult = async () => {
        dispatches++;
        const attempt = await db
          .selectFrom("proc.provider_attempt")
          .innerJoin("quota.cost_hold", "quota.cost_hold.id", "proc.provider_attempt.hold_id")
          .select([
            "proc.provider_attempt.state",
            "proc.provider_attempt.estimate_rates",
            "proc.provider_attempt.estimate_price_version",
            "quota.cost_hold.maximum_micros",
            "quota.cost_hold.closed_at",
          ])
          .where("proc.provider_attempt.run_id", "=", activeRunId)
          .executeTakeFirstOrThrow();
        expect(attempt).toEqual({
          state: "started",
          estimate_rates: dispatches === 1 ? firstRates : nextRates,
          estimate_price_version: `admin-${operationKeys[dispatches === 1 ? 0 : 1]}`,
          maximum_micros: String(settings.maximumMicros),
          closed_at: null,
        });
        if (dispatches === 1) {
          await saveEstimateRates(db, {
            rates: nextRates,
            operationKey: operationKeys[1],
            actorId: f.ctx.userId,
            reason: "Synthetic rate change during provider dispatch",
          });
        }
        expect(
          await db.selectFrom("quota.cost_policy").selectAll().executeTakeFirstOrThrow(),
        ).toEqual(policy);
      };
      await f.work();
      expect((await getRun(db, f.ctx, firstRun.id)).state).toBe("ready");
      const nextRun = await f.start();
      activeRunId = nextRun.id;
      await f.work();
      expect((await getRun(db, f.ctx, nextRun.id)).state).toBe("ready");
      expect(dispatches).toBe(2);
      const firstCost = await db
        .selectFrom("quota.provider_cost")
        .select(["amount_micros", "estimated_micros", "price_version"])
        .where("run_id", "=", firstRun.id)
        .executeTakeFirstOrThrow();
      const nextCost = await db
        .selectFrom("quota.provider_cost")
        .select(["amount_micros", "estimated_micros", "price_version"])
        .where("run_id", "=", nextRun.id)
        .executeTakeFirstOrThrow();
      expect(firstCost).toEqual({
        amount_micros: null,
        estimated_micros: "3",
        price_version: firstRevision.version,
      });
      expect(nextCost).toEqual({
        amount_micros: null,
        estimated_micros: "7",
        price_version: `admin-${operationKeys[1]}`,
      });
      expect(
        await db
          .selectFrom("proc.provider_attempt")
          .select(["estimate_rates", "estimate_price_version"])
          .where("run_id", "=", firstRun.id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ estimate_rates: firstRates, estimate_price_version: firstRevision.version });
    } finally {
      try {
        await localAdmin
          .deleteFrom("aip.estimate_rate_revision")
          .where("operation_key", "in", operationKeys)
          .execute();
      } finally {
        await localAdmin.destroy();
      }
    }
    expect(await readEstimateRates(db)).toEqual(previous);
  });
  it("cleans registered temporary objects using a single pool connection", async () => {
    const f = await fixture();
    const pending = await f.start();
    const store = new MemoryObjectStore();
    const objectId = await writeOwnedObject(db, store, f.ctx, {
      module: "proc",
      retention: "temporary",
      contentType: "audio/mpeg",
      bytes: Buffer.from("ID3 synthetic cleanup chunk"),
      now: new Date(),
      onRegistered: (id) => registerProcessingTemporaryObject(db, f.ctx, pending.id, id),
    });
    await cancelRun(db, f.ctx, pending.id);
    const singleConnection = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
    try {
      await cleanupSessionProcessing(singleConnection, f.ctx, f.session.id, { store });
      const object = await singleConnection
        .selectFrom("plt.storage_object")
        .select(["state", "key"])
        .where("id", "=", objectId)
        .executeTakeFirstOrThrow();
      expect(object.state).toBe("deleted");
      expect(await store.head(object.key)).toBeNull();
      const run = await singleConnection
        .selectFrom("proc.processing_run")
        .select("input_snapshot")
        .where("id", "=", pending.id)
        .executeTakeFirstOrThrow();
      expect(run.input_snapshot).toEqual({});
    } finally {
      await singleConnection.destroy();
    }
  });
  it("compares nested per-model configuration independently of JSONB key order", async () => {
    const f = await fixture();
    const configured = {
      ...settings,
      modelMaximumMicros: { "synthetic/vision": 10, "synthetic/llm": 10, "synthetic/tts": 2 },
    };
    const provider = Object.assign(f.provider, { settings: configured });
    const job = processingJob({ provider, store: new MemoryObjectStore() });
    const pending = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      { provider, job },
    );
    await runDueJobs(db, [job], { kinds: [job.kind], deadline: new Date(Date.now() + 5000) });
    expect((await getRun(db, f.ctx, pending.id)).state).toBe("ready");
    expect(provider.calls).toBe(1);
  });
  it("expires abandoned confirmed audio uploads using their input contract and releases the hold", async () => {
    const f = await fixture();
    const now = new Date();
    await db
      .updateTable("src.session_source")
      .set({ selected: false })
      .where("asset_id", "=", f.asset.id)
      .execute();
    const audio = await db
      .insertInto("src.asset")
      .values({
        user_id: f.ctx.userId,
        kind: "audio",
        declared_mime: "audio/mpeg",
        verified_mime: "audio/mpeg",
        size_bytes: 100,
        duration_ms: 1000,
        sha256: "c".repeat(64),
        display_name: "Synthetic local audio.mp3",
        contract_version: "1",
        retention: "device_only",
        operation_key: randomUUID(),
        request_hash: randomUUID(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("src.session_source")
      .values({
        user_id: f.ctx.userId,
        session_id: f.session.id,
        asset_id: audio.id,
        selected: true,
        role: "class_audio",
      })
      .execute();
    const pending = await f.start();
    expect(pending.state).toBe("awaiting_upload");
    expect((await allowance(db, f.ctx)).reserved.audio).toBe(1);
    await expireAwaitingUploads(db, now);
    expect((await getRun(db, f.ctx, pending.id)).state).toBe("awaiting_upload");
    const contract = await readInputContract(db, "1");
    await expireAwaitingUploads(db, new Date(Date.now() + contract.uploadTtlSeconds * 1000 + 1000));
    expect((await getRun(db, f.ctx, pending.id)).state).toBe("needs_input");
    expect((await getRun(db, f.ctx, pending.id)).lastError).toBe("audio_upload_rejected");
    expect((await allowance(db, f.ctx)).reserved.audio).toBe(0);
    expect((await allowance(db, f.ctx)).consumed.audio).toBe(0);
  });
  it("snapshots confirmed teaching preferences and leaves the run unchanged after later edits", async () => {
    const f = await fixture();
    await saveTeachingPreference(db, f.ctx, {
      key: "shorter_examples",
      origin: "explicit",
      value: true,
    });
    const run = await f.start();
    await saveTeachingPreference(db, f.ctx, {
      key: "shorter_examples",
      origin: "explicit",
      value: false,
    });
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.prompts[0]).toContain("explicitly prefers shorter");
    expect(f.provider.inputs[0]).toMatchObject({ teachingPreferences: { shorterExamples: true } });
  });
  it("OCRs only selected PDF pages through durable vision steps and deletes temporary page images", async () => {
    const f = await fixture();
    const store = new MemoryObjectStore();
    const now = new Date();
    await db
      .updateTable("src.session_source")
      .set({ selected: false })
      .where("asset_id", "=", f.asset.id)
      .execute();
    const objectId = await writeOwnedObject(db, store, f.ctx, {
      module: "src",
      retention: "durable",
      contentType: "application/pdf",
      bytes: Buffer.from("Synthetic parser-free PDF fixture"),
      now,
    });
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: f.ctx.userId,
        kind: "pdf",
        declared_mime: "application/pdf",
        verified_mime: "application/pdf",
        size_bytes: 33,
        sha256: "b".repeat(64),
        display_name: "Synthetic scanned.pdf",
        contract_version: "1",
        retention: "persistent",
        page_count: 2,
        original_object_id: objectId,
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        verified_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("src.session_source")
      .values({
        user_id: f.ctx.userId,
        session_id: f.session.id,
        asset_id: asset.id,
        role: "class_material",
        selected: true,
        ranges: JSON.stringify([{ start: 2, end: 2 }]),
      })
      .execute();
    await db.transaction().execute((tx) =>
      appendContentVersion(tx, f.ctx, asset.id, {
        originKey: "synthetic-pdf",
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {},
        units: [
          { id: "page-1", kind: "page", start: 1, status: "failed", reason: "ocr_required" },
          { id: "page-2", kind: "page", start: 2, status: "failed", reason: "ocr_required" },
        ],
        blocks: [],
      }),
    );
    const rendered: number[] = [];
    const images: string[] = [];
    const job = processingJob({
      provider: f.provider,
      store,
      preparePdfPage: async (input) => {
        rendered.push(input.page);
        const id = await writeOwnedObject(db, store, f.ctx, {
          module: "proc",
          retention: "temporary",
          contentType: "image/jpeg",
          bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          now,
        });
        images.push(id);
        return { page: input.page, objectId: id, mimeType: "image/jpeg" };
      },
    });
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      { provider: f.provider, job },
    );
    for (
      let invocation = 0;
      invocation < 4 && (await getRun(db, f.ctx, run.id)).state !== "ready";
      invocation++
    )
      await runDueJobs(db, [job], { kinds: [job.kind], deadline: new Date(Date.now() + 5000) });
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(rendered).toEqual([2]);
    expect(f.provider.calls).toBe(2);
    const objects = await db
      .selectFrom("plt.storage_object")
      .select("state")
      .where("id", "in", images)
      .execute();
    expect(objects.every((object) => object.state === "deleted")).toBe(true);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(1);
  });
  it("AC-13: duplicate requests create one run, one reservation and one valid publication", async () => {
    const f = await fixture();
    const key = randomUUID();
    const start = () =>
      createProcessingRun(
        db,
        f.ctx,
        { sessionId: f.session.id, operationKey: key },
        { provider: f.provider, job: f.job },
      );
    const [a, b] = await Promise.all([start(), start()]);
    expect(b).toEqual(a);
    await f.work();
    await f.work();
    expect((await getRun(db, f.ctx, a.id)).state).toBe("ready");
    expect(f.provider.calls).toBe(1);
    expect(await listVersions(db, f.ctx, f.session.id)).toHaveLength(1);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(1);
  });
  it("rolls back runs and jobs when the atomic reservation fails", async () => {
    const f = await fixture(false);
    await expect(f.start()).rejects.toMatchObject({ code: "quota_insufficient" });
    expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
    expect(f.provider.calls).toBe(0);
  });
  it("rejects cross-account run and result IDs without leaking content", async () => {
    const f = await fixture();
    const other = await learner();
    const run = await f.start();
    await expect(getRun(db, other, run.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelRun(db, other, run.id)).rejects.toMatchObject({ code: "not_found" });
    await f.work();
    await expect(getLatestVersion(db, other, f.session.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("AC-17: deleting during dispatch suppresses publication and refunds learner quota", async () => {
    const f = await fixture();
    const run = await f.start();
    f.provider.beforeResult = () =>
      deleteSession(db, f.ctx, f.session.id, {
        onDelete: (tx, id) => cancelSessionRuns(tx, f.ctx, id),
      }).then(() => undefined);
    await f.work();
    const row = await db
      .selectFrom("proc.processing_run")
      .selectAll()
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe("cancelled");
    expect(row.output_version_id).toBe(null);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(0);
    expect(
      await db
        .selectFrom("quota.provider_cost")
        .select("id")
        .where("run_id", "=", run.id)
        .execute(),
    ).toHaveLength(1);
  });
  it("rejects invalid evidence, releases quota and records actual provider cost", async () => {
    const f = await fixture();
    f.provider.invalidEvidence = true;
    const run = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("failed");
    expect(await getLatestVersion(db, f.ctx, f.session.id)).toBe(null);
    expect((await allowance(db, f.ctx)).reserved.document).toBe(0);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(0);
    expect(
      await db
        .selectFrom("quota.provider_cost")
        .select("id")
        .where("run_id", "=", run.id)
        .execute(),
    ).toHaveLength(1);
  });
  it("does not repeat ambiguous provider calls automatically or upon retry", async () => {
    const f = await fixture();
    f.provider.failure = new ProviderError("provider_outcome_unknown", false, true);
    const run = await f.start();
    await f.work();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("needs_input");
    expect(f.provider.calls).toBe(1);
    await expect(
      retryRun(db, f.ctx, run.id, randomUUID(), { provider: f.provider, job: f.job }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      createProcessingRun(
        db,
        f.ctx,
        { sessionId: f.session.id, operationKey: randomUUID() },
        { provider: f.provider, job: f.job },
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { retry: ["provider_outcome_unresolved"] } },
    });
  });
});
