import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import {
  cleanupFixtureProcessingJobs,
  runFixtureProcessingJobs,
  runFixtureProcessingStep,
} from "../../test/processing-jobs";
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
import { MemoryObjectStore, sha256Hex, writeOwnedObject } from "../plt";
import { allowance, amounts, configureCostPolicy, grantEntitlement } from "../quota";
import {
  appendContentVersion,
  readInputContract,
  type SourceClassification,
  selectSourceSnapshot,
  updateSourceSelection,
} from "../src";
import { retryRunAsAdmin } from "./admin";
import {
  beginAutomaticLearningBatch,
  getAutomaticLearningSession,
  requestAutomaticLearning,
  updateAutomaticLearningProgress,
} from "./automatic-state";
import { expireAwaitingUploads } from "./maintenance";
import { forgetPracticeSources } from "./practice-privacy";
import {
  cancelRun,
  cancelSessionRuns,
  cleanupSessionProcessing,
  createProcessingRun,
  getRun,
  listRuns,
  registerProcessingTemporaryObject,
  retryRun,
  selectProcessingSourceSnapshot,
} from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const fixtureSubjects: { userId: string; sessionId: string }[] = [];
afterAll(async () => {
  try {
    for (const subject of fixtureSubjects) {
      const runs = await db
        .selectFrom("proc.processing_run")
        .select("id")
        .where("user_id", "=", subject.userId)
        .where("session_id", "=", subject.sessionId)
        .execute();
      await cleanupFixtureProcessingJobs(
        db,
        runs.map((run) => run.id),
      );
    }
  } finally {
    await db.destroy();
  }
});
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
  sourceClassifications: { sourceId: string; classification: SourceClassification }[] = [];
  evidence: "material" | "user_notes" | "board" = "material";
  visualClassification?: SourceClassification;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls++;
    this.prompts.push(input.system);
    if (input.schemaName === "pdf_page_extraction" || input.schemaName === "source_extraction")
      return {
        output: input.schema.parse({
          blocks: [{ id: "ocr-1", text: "Synthetic selected PDF text" }],
          classification: this.visualClassification,
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
    // These refusal fixtures deliberately return a known invalid correction.
    // Keyed repair input is not the original sources.blocks transport.
    if (input.schemaName === "class_knowledge_repair")
      throw new ProviderError("provider_schema_invalid", false, false, {
        requestId: "synthetic-invalid-repair",
        provider: this.name,
        model: input.model,
        actualMicros: this.actualMicros,
        usage: { inputTokens: 10, outputTokens: 10 },
      });
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
          evidence: this.evidence,
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
      output: input.schema.parse({ ...model, sourceClassifications: this.sourceClassifications }),
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
  fixtureSubjects.push({ userId: ctx.userId, sessionId: session.id });
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
    runFixtureProcessingJobs(db, job, { userId: ctx.userId, sessionId: session.id });
  return { ctx, session, asset, provider, job, start, work };
}
describe("durable processing, atomic quota and provenance on Postgres", () => {
  it("operator retry replays one acknowledgement, binds blocked intent, and rejects a superseded class run", async () => {
    const f = await fixture();
    f.provider.failure = new ProviderError("provider_http_400", false, false);
    const failed = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, failed.id)).state).toBe("failed");
    const intent = await requestAutomaticLearning(db, f.ctx, f.session.id, { changed: false });
    await updateAutomaticLearningProgress(db, f.ctx, f.session.id, intent.requestVersion, {
      state: "blocked",
      runId: failed.id,
      lastError: "quota_insufficient",
    });
    const historical = await db
      .selectFrom("proc.processing_run")
      .selectAll()
      .where("id", "=", failed.id)
      .executeTakeFirstOrThrow();
    // An auxiliary operation can be newer without becoming this class's retry target.
    await db
      .insertInto("proc.processing_run")
      .values({
        ...historical,
        id: randomUUID(),
        kind: "auxiliary",
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        created_at: new Date(Date.now() + 1000),
      })
      .execute();
    f.provider.failure = undefined;
    const command = {
      runId: failed.id,
      actorId: randomUUID(),
      operationKey: randomUUID(),
      reason: "Synthetic operator reviewed the exact failed class",
      requestId: randomUUID(),
    };
    const invoke = () => retryRunAsAdmin(db, command, { provider: f.provider, job: f.job });
    const [first, replay] = await Promise.all([invoke(), invoke()]);
    expect(replay.id).toBe(first.id);
    expect(replay.reservationId).toBe(first.reservationId);
    expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toMatchObject({
      requestVersion: intent.requestVersion,
      state: "processing",
      runId: first.id,
      lastError: null,
    });
    expect((await allowance(db, f.ctx)).reserved.document).toBe(1);
    await f.work();
    expect((await getRun(db, f.ctx, first.id)).state).toBe("ready");
    await updateAutomaticLearningProgress(db, f.ctx, f.session.id, intent.requestVersion, {
      state: "ready",
      runId: first.id,
      lastError: null,
    });
    expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toMatchObject({
      requestVersion: intent.requestVersion,
      state: "ready",
      runId: first.id,
    });
    const settled = await allowance(db, f.ctx);
    const calls = f.provider.calls;
    expect((await invoke()).id).toBe(first.id);
    await expect(
      retryRunAsAdmin(
        db,
        { ...command, operationKey: randomUUID() },
        { provider: f.provider, job: f.job },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await allowance(db, f.ctx)).toEqual(settled);
    expect(f.provider.calls).toBe(calls);
    expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(2);
  });

  it.each(["batch", "different_run"] as const)(
    "operator retry preserves a newer automatic %s instead of attaching it to old work",
    async (changed) => {
      const f = await fixture();
      f.provider.failure = new ProviderError("provider_http_400", false, false);
      const failed = await f.start();
      await f.work();
      const intent = await requestAutomaticLearning(db, f.ctx, f.session.id, { changed: false });
      await updateAutomaticLearningProgress(db, f.ctx, f.session.id, intent.requestVersion, {
        state: "blocked",
        runId: failed.id,
        lastError: "quota_insufficient",
      });
      if (changed === "batch")
        await beginAutomaticLearningBatch(db, f.ctx, f.session.id, randomUUID());
      else {
        const row = await db
          .selectFrom("proc.processing_run")
          .selectAll()
          .where("id", "=", failed.id)
          .executeTakeFirstOrThrow();
        const otherId = randomUUID();
        await db
          .insertInto("proc.processing_run")
          .values({
            ...row,
            id: otherId,
            operation_key: randomUUID(),
            request_hash: randomUUID(),
            created_at: new Date(row.created_at.getTime() - 1000),
          })
          .execute();
        await db
          .updateTable("proc.automatic_session")
          .set({ run_id: otherId })
          .where("user_id", "=", f.ctx.userId)
          .where("session_id", "=", f.session.id)
          .execute();
      }
      const before = await getAutomaticLearningSession(db, f.ctx, f.session.id);
      const units = await allowance(db, f.ctx);
      await expect(
        retryRunAsAdmin(
          db,
          {
            runId: failed.id,
            actorId: randomUUID(),
            operationKey: randomUUID(),
            reason: "Synthetic stale retry must be rejected",
            requestId: randomUUID(),
          },
          { provider: f.provider, job: f.job },
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toEqual(before);
      expect(await allowance(db, f.ctx)).toEqual(units);
    },
  );

  it.each([
    ["session", "processing_budget_session"],
    ["userMonth", "processing_budget_user_month"],
    ["systemDay", "processing_budget_system_day"],
    ["systemMonth", "processing_budget_system_month"],
  ] as const)(
    "preserves the %s AI budget blocker without dispatching or consuming learner units",
    async (scope, code) => {
      const f = await fixture();
      const policy = await db.selectFrom("quota.cost_policy").selectAll().executeTakeFirstOrThrow();
      const before = await allowance(db, f.ctx);
      const run = await f.start();
      try {
        await configureCostPolicy(
          db,
          {
            version: "synthetic-cost-blocker",
            currency: "USD",
            killSwitch: false,
            limits: {
              session: 100000000,
              userMonth: 100000000,
              systemDay: 100000000,
              systemMonth: 100000000,
              [scope]: 9,
            },
          },
          { actorId: "synthetic-operator", reason: "Local cost blocker regression" },
        );
        await f.work();
        expect(await getRun(db, f.ctx, run.id)).toMatchObject({ state: "failed", lastError: code });
        expect(f.provider.calls).toBe(0);
        expect(
          await db
            .selectFrom("proc.provider_attempt")
            .select("id")
            .where("run_id", "=", run.id)
            .execute(),
        ).toHaveLength(0);
        expect(await allowance(db, f.ctx)).toEqual(before);
        expect(
          await db
            .selectFrom("quota.reservation")
            .select(["closed_at", "settled_amounts"])
            .where("id", "=", run.reservationId)
            .executeTakeFirstOrThrow(),
        ).toMatchObject({ closed_at: expect.any(Date), settled_amounts: amounts({}) });
      } finally {
        await configureCostPolicy(
          db,
          {
            version: policy.version,
            currency: policy.currency,
            killSwitch: policy.kill_switch,
            limits: policy.limits as {
              session: number;
              userMonth: number;
              systemDay: number;
              systemMonth: number;
            },
          },
          { actorId: "synthetic-operator", reason: "Restore local fixture cost policy" },
        );
      }
    },
  );

  it("FR-PROC-003 preserves a changed provider configuration diagnostic without dispatching", async () => {
    const f = await fixture();
    const run = await f.start();
    const changed: AiProvider = {
      name: f.provider.name,
      mode: f.provider.mode,
      settings: { ...f.provider.settings, promptVersion: "changed" },
      structured: (input) => f.provider.structured(input),
      transcribe: (input) => f.provider.transcribe(input),
      speech: () => f.provider.speech(),
    };
    const job = processingJob({ provider: changed, store: new MemoryObjectStore() });
    await runFixtureProcessingStep(db, job, { runId: run.id, userId: f.ctx.userId });
    expect(await getRun(db, f.ctx, run.id)).toMatchObject({
      state: "failed",
      lastError: "settings_changed",
    });
    expect(f.provider.calls).toBe(0);
    expect((await allowance(db, f.ctx)).reserved.document).toBe(0);
  });

  it.each([false, true])(
    "FR-PROC-003 checkpoints knowledge stages before optional voice (%s)",
    async (withVoice) => {
      const f = await fixture();
      await updateProfile(
        db,
        f.ctx,
        { field: "explanation_language", explanationLanguage: "first_language" },
        { now: new Date() },
      );
      const calls: string[] = [];
      let primaryContext: unknown;
      f.provider.structured = async <T>(input: StructuredInput<T>): Promise<ProviderResult<T>> => {
        calls.push(input.schemaName);
        const encoded = JSON.parse(input.input);
        if (input.schemaName === "class_knowledge") primaryContext = encoded.lessonContext;
        let output: unknown;
        if (input.schemaName === "class_knowledge_translation") {
          output = {
            language: "fa",
            translations: encoded.targets.map((target: { key: string }) => ({
              key: target.key,
              text: "این توضیح آموزشی فارسی است.",
            })),
          };
        } else {
          const claim =
            input.schemaName === "class_knowledge_repair"
              ? {
                  id: "claim-1",
                  text: "This explanation still needs Persian translation.",
                  evidenceKey: encoded.sources[0].evidence[0][0],
                  uncertain: false,
                }
              : {
                  id: "claim-1",
                  text: "This explanation needs Persian translation.",
                  origin: "from_class",
                  creation: "ai_generation",
                  evidence: "material",
                  sourceRefs: [encoded.sources[0].allowedSourceRefs[0]],
                  speakerRole: "unknown",
                  uncertain: false,
                };
          output = {
            schemaVersion: "1",
            title: "Present perfect",
            language: { learning: "en", explanation: "fa" },
            summary: [claim],
            topics: [],
            learningItems: [],
            homework: [],
            uncertainties: [],
            coverage: { complete: true, missingSourceIds: [] },
          };
        }
        return {
          output: input.schema.parse(output),
          requestId: `synthetic-separated-${calls.length}`,
          model: input.model,
          provider: f.provider.name,
          actualMicros: 1,
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      };
      const run = await f.start();
      const job = withVoice
        ? processingJob({
            provider: f.provider,
            store: new MemoryObjectStore(),
            diarizeVoice: async () => {
              throw new Error("Text sources must not request voice analysis");
            },
          })
        : f.job;
      const subject = { runId: run.id, userId: f.ctx.userId };
      const snapshots: unknown[] = [];
      let contextSnapshot: unknown;
      for (const [index, stage] of [
        "knowledge",
        "knowledge:repair",
        "knowledge:repair-language",
      ].entries()) {
        const before = await db
          .selectFrom("proc.processing_run")
          .select("job_id")
          .where("id", "=", run.id)
          .executeTakeFirstOrThrow();
        expect(await runFixtureProcessingStep(db, job, subject)).toBe(true);
        expect(calls).toHaveLength(index + 1);
        const steps = await db
          .selectFrom("proc.run_step")
          .selectAll()
          .where("run_id", "=", run.id)
          .where("step", "like", "knowledge%")
          .orderBy("completed_at")
          .execute();
        const expectedPaidSteps = [
          "knowledge",
          "knowledge:repair",
          "knowledge:repair-language",
        ].slice(0, index + 1);
        expect(steps.map((step) => step.step).sort()).toEqual(
          ["knowledge:input-context", ...expectedPaidSteps].sort(),
        );
        const context = steps.find((step) => step.step === "knowledge:input-context");
        expect(primaryContext).toEqual({ date: f.session.classDate });
        expect(context?.output).toEqual({ version: 1, date: f.session.classDate });
        if (index === 0) contextSnapshot = context;
        else expect(context).toEqual(contextSnapshot);
        const paidSteps = steps.filter((step) => step.step !== "knowledge:input-context");
        expect(paidSteps.map((step) => step.step)).toEqual(expectedPaidSteps);
        expect(paidSteps.slice(0, index)).toEqual(snapshots);
        snapshots.push(paidSteps[index]);
        const after = await getRun(db, f.ctx, run.id);
        if (stage !== "knowledge:repair-language" || withVoice) {
          expect(after.state).toBe("processing");
          const continued = await db
            .selectFrom("proc.processing_run")
            .select("job_id")
            .where("id", "=", run.id)
            .executeTakeFirstOrThrow();
          expect(continued.job_id).not.toBe(before.job_id);
          expect(await getLatestVersion(db, f.ctx, f.session.id)).toBeNull();
          expect((await allowance(db, f.ctx)).reserved.document).toBeGreaterThan(0);
        } else expect(after.state).toBe("ready");
      }
      expect(calls).toEqual([
        "class_knowledge",
        "class_knowledge_repair",
        "class_knowledge_translation",
      ]);
      if (withVoice) {
        expect(await runFixtureProcessingStep(db, job, subject)).toBe(true);
        expect(calls).toHaveLength(3);
      }
      expect(await runFixtureProcessingStep(db, job, subject)).toBe(false);
      expect(await listVersions(db, f.ctx, f.session.id)).toHaveLength(1);
      expect((await allowance(db, f.ctx)).reserved.document).toBe(0);
      expect((await getLatestVersion(db, f.ctx, f.session.id))?.model.summary[0]?.text).toBe(
        "این توضیح آموزشی فارسی است.",
      );
    },
  );

  it("classifies personal notes during the existing knowledge call without assigning authorship", async () => {
    const f = await fixture();
    f.provider.sourceClassifications = [
      { sourceId: f.asset.id, classification: { role: "user_notes", confidence: "high" } },
    ];
    f.provider.evidence = "user_notes";
    const run = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.calls).toBe(1);
    expect((await getLatestVersion(db, f.ctx, f.session.id))?.model.summary[0]).toMatchObject({
      evidence: "user_notes",
      speakerRole: "unknown",
    });
    expect(
      await db
        .selectFrom("src.session_source")
        .select("role")
        .where("asset_id", "=", f.asset.id)
        .executeTakeFirst(),
    ).toEqual({ role: "user_notes" });
    const source = (await selectSourceSnapshot(db, f.ctx, f.session.id)).sources[0];
    expect(source?.role).toBe("user_notes");
    await updateSourceSelection(db, f.ctx, f.session.id, f.asset.id, {
      role: "class_material",
      selected: true,
      ranges: [],
      timeStatus: "unknown",
      contentVersionId: source?.contentVersionId,
    });
    expect((await selectSourceSnapshot(db, f.ctx, f.session.id)).sources[0]?.role).toBe(
      "user_notes",
    );
    // Older cached provider output may omit categories; retain the accepted source category.
    f.provider.sourceClassifications = [];
    const compatible = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, compatible.id)).state).toBe("ready");
  });
  it("detects a legacy board image in the existing vision step and preserves corrected content and confirmed versions", async () => {
    const f = await fixture();
    const store = new MemoryObjectStore();
    const bytes = Buffer.from("Synthetic board photo bytes");
    const objectId = await writeOwnedObject(db, store, f.ctx, {
      module: "src",
      retention: "durable",
      contentType: "image/jpeg",
      bytes,
      now: new Date(),
    });
    await db
      .updateTable("src.asset")
      .set({
        kind: "image",
        declared_mime: "image/jpeg",
        verified_mime: "image/jpeg",
        size_bytes: bytes.length,
        sha256: sha256Hex(bytes),
        original_object_id: objectId,
      })
      .where("id", "=", f.asset.id)
      .execute();
    const priorLink = await db
      .selectFrom("src.session_source")
      .select("selected_content_version_id")
      .where("asset_id", "=", f.asset.id)
      .executeTakeFirstOrThrow();
    expect(
      (await selectSourceSnapshot(db, f.ctx, f.session.id)).sources[0]?.contentVersionId,
    ).toBeNull();
    expect(
      (
        await selectSourceSnapshot(db, f.ctx, f.session.id, {
          sources: [
            { sourceId: f.asset.id, contentVersionId: priorLink.selected_content_version_id },
          ],
        })
      ).sources[0]?.contentVersionId,
    ).toBe(priorLink.selected_content_version_id);
    f.provider.visualClassification = { role: "board_photo", confidence: "high" };
    f.provider.evidence = "board";
    const job = processingJob({ provider: f.provider, store });
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      { provider: f.provider, job },
    );
    for (
      let attempt = 0;
      attempt < 4 && (await getRun(db, f.ctx, run.id)).state !== "ready";
      attempt++
    )
      await runFixtureProcessingJobs(db, job, { userId: f.ctx.userId, sessionId: f.session.id });
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.calls).toBe(2);
    expect((await selectSourceSnapshot(db, f.ctx, f.session.id)).sources[0]?.role).toBe(
      "board_photo",
    );
    const correctedId = await db.transaction().execute((tx) =>
      appendContentVersion(tx, f.ctx, f.asset.id, {
        originKey: "corrected-board",
        schemaVersion: "1",
        provenance: "user_correction",
        settings: {},
        units: [{ id: "image", kind: "document", start: 1 }],
        blocks: [
          {
            id: "corrected",
            kind: "paragraph",
            unitId: "image",
            text: "Learner corrected board text",
          },
        ],
      }),
    );
    expect((await selectSourceSnapshot(db, f.ctx, f.session.id)).sources[0]).toMatchObject({
      contentVersionId: correctedId,
      role: "board_photo",
      blocks: [{ text: "Learner corrected board text" }],
    });
  });
  it("FR-PLT-005 leaves an image's vision call that could not finish before the runner's deadline to a fresh runner", async () => {
    const f = await fixture();
    const store = new MemoryObjectStore();
    const bytes = Buffer.from("Synthetic board photo bytes");
    const objectId = await writeOwnedObject(db, store, f.ctx, {
      module: "src",
      retention: "durable",
      contentType: "image/jpeg",
      bytes,
      now: new Date(),
    });
    await db
      .updateTable("src.asset")
      .set({
        kind: "image",
        declared_mime: "image/jpeg",
        verified_mime: "image/jpeg",
        size_bytes: bytes.length,
        sha256: sha256Hex(bytes),
        original_object_id: objectId,
      })
      .where("id", "=", f.asset.id)
      .execute();
    const job = processingJob({ provider: f.provider, store });
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      { provider: f.provider, job },
    );
    const invoke = (deadline?: Date) =>
      job.run(
        { runId: run.id, userId: f.ctx.userId },
        {
          db,
          now: () => new Date(),
          job: { id: randomUUID(), attempt: 1 },
          step: async () => "ran" as const,
          ...(deadline ? { deadline } : {}),
        },
      );
    // Less than one vision request plus the time kept after it.
    await invoke(new Date(Date.now() + settings.timeoutMs));
    expect(f.provider.calls).toBe(0);
    expect((await getRun(db, f.ctx, run.id)).state).toBe("processing");
    for (
      let attempt = 0;
      attempt < 4 && (await getRun(db, f.ctx, run.id)).state !== "ready";
      attempt++
    )
      await invoke();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.calls).toBe(2);
  });
  it("falls back to class material for uncertain notes and refuses foreign category IDs", async () => {
    const f = await fixture();
    f.provider.sourceClassifications = [
      { sourceId: f.asset.id, classification: { role: "user_notes", confidence: "uncertain" } },
    ];
    const run = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(
      await db
        .selectFrom("src.session_source")
        .select("role")
        .where("asset_id", "=", f.asset.id)
        .executeTakeFirst(),
    ).toEqual({ role: "class_material" });
    f.provider.sourceClassifications = [
      { sourceId: randomUUID(), classification: { role: "user_notes", confidence: "high" } },
    ];
    const invalid = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, invalid.id)).state).toBe("failed");
    expect(await listVersions(db, f.ctx, f.session.id)).toHaveLength(1);
  });
  it("invalidates a legacy partial transcript when switching to whole audio and preserves historical input", async () => {
    const f = await fixture();
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
        size_bytes: 100,
        duration_ms: 4000,
        sha256: "c".repeat(64),
        display_name: "Partial.mp3",
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
        role: "class_audio",
        selected: true,
        ranges: JSON.stringify([{ start: 1000, end: 2000 }]),
      })
      .execute();
    const historical = await f.start();
    await cancelRun(db, f.ctx, historical.id);
    const before = await db
      .selectFrom("proc.processing_run")
      .select("input_snapshot")
      .where("id", "=", historical.id)
      .executeTakeFirstOrThrow();
    const contentId = await db.transaction().execute((tx) =>
      appendContentVersion(tx, f.ctx, audio.id, {
        originKey: `processing:${historical.id}:${audio.id}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {},
        units: [{ id: "partial", kind: "time", start: 1000, end: 2000 }],
        blocks: [
          {
            id: "partial-text",
            kind: "transcript",
            unitId: "partial",
            text: "Only part of the lecture",
          },
        ],
      }),
    );
    expect(
      (await selectProcessingSourceSnapshot(db, f.ctx, f.session.id)).sources[0]?.contentVersionId,
    ).toBe(contentId);
    await db
      .updateTable("src.session_source")
      .set({ ranges: JSON.stringify([]) })
      .where("asset_id", "=", audio.id)
      .execute();
    const complete = await selectProcessingSourceSnapshot(db, f.ctx, f.session.id);
    expect(complete.sources[0]).toMatchObject({ ranges: [], contentVersionId: null, blocks: [] });
    const next = await f.start();
    expect(next.state).toBe("awaiting_upload");
    expect((await allowance(db, f.ctx)).reserved.audio).toBe(4);
    expect(
      await db
        .selectFrom("proc.processing_run")
        .select("input_snapshot")
        .where("id", "=", historical.id)
        .executeTakeFirstOrThrow(),
    ).toEqual(before);
    await cancelRun(db, f.ctx, next.id);
  });
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
    await runFixtureProcessingJobs(db, job, { userId: f.ctx.userId, sessionId: f.session.id });
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
    expect((await getRun(db, f.ctx, pending.id)).lastError).toBe("audio_upload_not_started");
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
  it("AC-D46-05 snapshots declared level and goal before later profile edits without an extra AI call", async () => {
    const f = await fixture();
    await updateProfile(
      db,
      f.ctx,
      { field: "level_goal", level: "A2", goal: "esol" },
      { now: new Date() },
    );
    const run = await f.start();
    const saved = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    expect(saved.settings).toMatchObject({
      learnerContext: { version: 1, declaredLevel: "A2", goal: "esol" },
    });
    await updateProfile(
      db,
      f.ctx,
      { field: "level_goal", level: "C1", goal: "ielts" },
      { now: new Date() },
    );
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.inputs[0]).toMatchObject({
      learnerContext: { version: 1, declaredLevel: "A2", goal: "esol" },
    });
    expect(f.provider.prompts[0]).toContain("short, concrete steps");
    expect(f.provider.prompts[0]).toContain("declared ESOL goal");
    expect(f.provider.prompts[0]).not.toContain("declared IELTS goal");
    expect(f.provider.calls).toBe(1);
  });
  it("AC-D46-05 processes legacy run settings with absent learner context without inferring current profile choices", async () => {
    const f = await fixture();
    await updateProfile(
      db,
      f.ctx,
      { field: "level_goal", level: "C1", goal: "ielts" },
      { now: new Date() },
    );
    const run = await f.start();
    const saved = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    const { learnerContext: _learnerContext, ...legacy } = saved.settings as Record<
      string,
      unknown
    >;
    await db
      .updateTable("proc.processing_run")
      .set({ settings: JSON.stringify(legacy) })
      .where("id", "=", run.id)
      .execute();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.inputs[0]).not.toHaveProperty("learnerContext");
    expect(f.provider.prompts[0]).toContain("without guessing or assigning a level");
    expect(f.provider.prompts[0]).not.toContain("declared IELTS goal");
    expect(f.provider.calls).toBe(1);
  });
  it("D49 freezes bounded memory at run start and sends only matched points to the one generation", async () => {
    const f = await fixture();
    await saveTeachingPreference(db, f.ctx, {
      key: "simpler_explanations",
      origin: "explicit",
      value: true,
    });
    const other = await createSession(db, f.ctx, {}, { key: randomUUID() });
    fixtureSubjects.push({ userId: f.ctx.userId, sessionId: other.id });
    const candidate = (
      target: string,
      scope: "this_class" | "same_course",
      sourceSessionId = scope === "this_class" ? f.session.id : other.id,
    ) => ({
      target,
      reason: "recall_difficulty" as const,
      scope,
      againCount: 3,
      lastEvidenceDate: "2026-10-06",
      sourceSessionId,
    });
    const supplied = [
      candidate("be pressed for time", "this_class"),
      candidate("present perfect", "same_course"),
      candidate("get on with sb", "same_course"),
    ];
    // A point read before its class was deleted (or from any class not live for this owner).
    const gone = candidate("present perfect tense", "same_course", randomUUID());
    let snapshotCalls = 0;
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      {
        provider: f.provider,
        job: f.job,
        teachingMemory: true,
        practiceCandidates: async (_tx, input) => {
          snapshotCalls++;
          expect(input.sessionId).toBe(f.session.id);
          return [...supplied, gone];
        },
      },
    );
    expect(snapshotCalls).toBe(1);
    const saved = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    expect(saved.settings).toMatchObject({
      learnerContext: { version: 2, simplerExplanations: true, practiceCandidates: supplied },
    });
    // Later choices and evidence do not redefine the queued request.
    await saveTeachingPreference(db, f.ctx, {
      key: "simpler_explanations",
      origin: "explicit",
      value: false,
    });
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.calls).toBe(1);
    expect(f.provider.inputs[0]).toMatchObject({
      learnerContext: {
        version: 2,
        simplerExplanations: true,
        practiceFocus: [
          { target: "be pressed for time", reason: "recall_difficulty" },
          { target: "present perfect", reason: "recall_difficulty" },
        ],
      },
    });
    expect(JSON.stringify(f.provider.inputs[0])).not.toMatch(/get on with|againCount|2026-10-06/);
    expect(f.provider.prompts[0]).toContain("explicitly chose simpler explanations");
    expect(f.provider.prompts[0]).toContain("learnerContext.practiceFocus lists");
    const version = await getLatestVersion(db, f.ctx, f.session.id);
    expect(version?.generation).toMatchObject({
      teachingAdaptation: {
        version: 1,
        simplerExplanations: true,
        shorterExamples: false,
        focus: [supplied[0], supplied[1]],
        linkedItemIds: [],
      },
    });
    // Deleting the other class removes its copied points; this class's own point stays.
    await forgetPracticeSources(db, f.ctx, [other.id]);
    const scrubbed = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    expect(scrubbed.settings).toMatchObject({
      provider: (saved.settings as { provider: unknown }).provider,
      learnerContext: { version: 2, simplerExplanations: true, practiceCandidates: [supplied[0]] },
    });
    expect(JSON.stringify(scrubbed.settings)).not.toContain(other.id);
    const redacted = await getLatestVersion(db, f.ctx, f.session.id);
    expect(redacted?.generation).toMatchObject({ teachingAdaptation: { focus: [supplied[0]] } });
    expect(JSON.stringify(redacted?.generation)).not.toMatch(/present perfect|get on with/);
    expect(redacted?.model).toEqual(version?.model);
    // Repeating the cleanup changes nothing.
    await forgetPracticeSources(db, f.ctx, [other.id]);
    expect(
      (
        await db
          .selectFrom("proc.processing_run")
          .select("settings")
          .where("id", "=", run.id)
          .executeTakeFirstOrThrow()
      ).settings,
    ).toEqual(scrubbed.settings);
  });
  it("D49 recovery runs keep the recovered run's memory points instead of fresher evidence", async () => {
    const f = await fixture();
    const original = [
      {
        target: "present perfect",
        reason: "asked_simpler" as const,
        scope: "this_class" as const,
        againCount: 0,
        lastEvidenceDate: "2026-10-05",
        sourceSessionId: f.session.id,
      },
    ];
    const first = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      {
        provider: f.provider,
        job: f.job,
        teachingMemory: true,
        practiceCandidates: async () => original,
      },
    );
    await f.work();
    expect((await getRun(db, f.ctx, first.id)).state).toBe("ready");
    const recovery = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      {
        provider: f.provider,
        job: f.job,
        reuseCompletedKnowledge: true,
        teachingMemory: true,
        practiceCandidates: async () => {
          throw new Error("A recovery run must not take a fresh memory snapshot");
        },
      },
    );
    const saved = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", recovery.id)
      .executeTakeFirstOrThrow();
    expect(saved.settings).toMatchObject({
      learnerContext: { version: 2, practiceCandidates: original },
    });
  });
  it("D49 without memory or a simpler choice keeps the version 1 snapshot and no extra call", async () => {
    const f = await fixture();
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      {
        provider: f.provider,
        job: f.job,
        teachingMemory: true,
        practiceCandidates: async () => [],
      },
    );
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.inputs[0]).toMatchObject({ learnerContext: { version: 1 } });
    expect(f.provider.prompts[0]).not.toContain("practiceFocus lists");
    expect(f.provider.calls).toBe(1);
    expect((await getLatestVersion(db, f.ctx, f.session.id))?.generation).toMatchObject({
      teachingAdaptation: { version: 1, focus: [], simplerExplanations: false },
    });
  });
  it("D49 release switch: without teachingMemory no choice or memory point reaches generation", async () => {
    const f = await fixture();
    await saveTeachingPreference(db, f.ctx, {
      key: "simpler_explanations",
      origin: "explicit",
      value: true,
    });
    let snapshotCalls = 0;
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      {
        provider: f.provider,
        job: f.job,
        practiceCandidates: async () => {
          snapshotCalls++;
          return [];
        },
      },
    );
    expect(snapshotCalls).toBe(0);
    const saved = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", run.id)
      .executeTakeFirstOrThrow();
    expect((saved.settings as { learnerContext: unknown }).learnerContext).toEqual({ version: 1 });
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
    expect(f.provider.inputs[0]).toMatchObject({ learnerContext: { version: 1 } });
    expect(f.provider.prompts[0]).not.toContain("explicitly chose simpler explanations");
    expect(f.provider.prompts[0]).not.toContain("practiceFocus lists");
    expect((await getLatestVersion(db, f.ctx, f.session.id))?.generation).toMatchObject({
      teachingAdaptation: { focus: [], simplerExplanations: false },
    });
  });
  it.each(["single", "batch"] as const)(
    "OCRs only selected PDF pages with the %s renderer, preserves paid step boundaries and deletes temporary images",
    async (renderer) => {
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
          page_count: renderer === "batch" ? 5 : 2,
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
          ranges: JSON.stringify([{ start: 2, end: renderer === "batch" ? 5 : 2 }]),
        })
        .execute();
      await db.transaction().execute((tx) =>
        appendContentVersion(tx, f.ctx, asset.id, {
          originKey: "synthetic-pdf",
          schemaVersion: "1",
          provenance: "machine_extraction",
          settings: {},
          units: Array.from({ length: renderer === "batch" ? 5 : 2 }, (_, index) => ({
            id: `page-${index + 1}`,
            kind: "page" as const,
            start: index + 1,
            status: "failed" as const,
            reason: "ocr_required",
          })),
          blocks: [],
        }),
      );
      const rendered: number[] = [];
      const batches: number[][] = [];
      const images: string[] = [];
      const renderPage = async (page: number) => {
        rendered.push(page);
        const id = await writeOwnedObject(db, store, f.ctx, {
          module: "proc",
          retention: "temporary",
          contentType: "image/jpeg",
          bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          now,
        });
        images.push(id);
        return { page, objectId: id, mimeType: "image/jpeg" as const };
      };
      const job = processingJob({
        provider: f.provider,
        store,
        ...(renderer === "batch"
          ? {
              preparePdfPages: async ({ pages }: { pages: number[] }) => {
                batches.push(pages);
                const result = [];
                for (const page of pages) result.push(await renderPage(page));
                return result;
              },
            }
          : { preparePdfPage: async ({ page }: { page: number }) => renderPage(page) }),
      });
      const run = await createProcessingRun(
        db,
        f.ctx,
        { sessionId: f.session.id, operationKey: randomUUID() },
        { provider: f.provider, job },
      );
      if (renderer === "batch") {
        // Diagnosis 2026-10-12 (0.5): the rendered batch is read in parallel within the vision
        // bound; each page is still its own paid step and checkpoint.
        await runFixtureProcessingStep(db, job, { userId: f.ctx.userId, runId: run.id });
        expect(batches).toEqual([[2, 3, 4]]);
        expect(f.provider.calls).toBe(3);
        expect(
          (
            await db
              .selectFrom("proc.provider_attempt")
              .select(["step", "state"])
              .where("run_id", "=", run.id)
              .execute()
          ).sort((left, right) => left.step.localeCompare(right.step)),
        ).toEqual(
          [2, 3, 4].map((page) => ({ step: `vision:pdf:${asset.id}:${page}`, state: "succeeded" })),
        );
        await runFixtureProcessingStep(db, job, { userId: f.ctx.userId, runId: run.id });
        expect(batches).toEqual([[2, 3, 4], [5]]);
        expect(f.provider.calls).toBe(4);
      }
      for (
        let invocation = 0;
        invocation < 4 && (await getRun(db, f.ctx, run.id)).state !== "ready";
        invocation++
      )
        await runFixtureProcessingJobs(db, job, { userId: f.ctx.userId, sessionId: f.session.id });
      expect((await getRun(db, f.ctx, run.id)).state).toBe("ready");
      expect(rendered).toEqual(renderer === "batch" ? [2, 3, 4, 5] : [2]);
      if (renderer === "batch") expect(batches).toEqual([[2, 3, 4], [5]]);
      expect(f.provider.calls).toBe(renderer === "batch" ? 5 : 2);
      const objects = await db
        .selectFrom("plt.storage_object")
        .select("state")
        .where("id", "in", images)
        .execute();
      expect(objects.every((object) => object.state === "deleted")).toBe(true);
      expect((await allowance(db, f.ctx)).consumed.document).toBe(renderer === "batch" ? 4 : 1);
    },
  );
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
  it("rejects invalid evidence and its failed bounded correction without consuming allowance", async () => {
    const f = await fixture();
    f.provider.invalidEvidence = true;
    const run = await f.start();
    await f.work();
    expect((await getRun(db, f.ctx, run.id)).state).toBe("failed");
    expect(await getLatestVersion(db, f.ctx, f.session.id)).toBe(null);
    expect((await allowance(db, f.ctx)).reserved.document).toBe(0);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(0);
    const costs = await db
      .selectFrom("quota.provider_cost")
      .select("amount_micros")
      .where("run_id", "=", run.id)
      .execute();
    expect(costs).toHaveLength(2);
    expect(costs.reduce((sum, cost) => sum + Number(cost.amount_micros), 0)).toBe(2);
    expect(f.provider.calls).toBe(2);
    expect(
      await db
        .selectFrom("proc.provider_attempt")
        .select(["step", "state", "provider_request_id"])
        .where("run_id", "=", run.id)
        .orderBy("step")
        .execute(),
    ).toEqual([
      { step: "knowledge", state: "succeeded", provider_request_id: "synthetic-generation" },
      {
        step: "knowledge:repair",
        state: "failed",
        provider_request_id: "synthetic-invalid-repair",
      },
    ]);
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
