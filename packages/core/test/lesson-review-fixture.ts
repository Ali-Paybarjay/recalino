import { randomUUID } from "node:crypto";
import { updateProfile } from "../src/acc";
import type { AiProvider, ProviderSettings } from "../src/aip";
import type { Database } from "../src/db";
import { publishKnowledgeVersion } from "../src/lkm";
import { cancelJob, MemoryObjectStore } from "../src/plt";
import { createProcessingRun, processingJob, sourceSnapshotSchema } from "../src/proc";
import { amounts, configureCostPolicy, grantEntitlement, settleAllowance } from "../src/quota";
import { appendContentVersion } from "../src/src";
import { studyFixture, syntheticKnowledge } from "./study-fixture";

export const lessonReviewFixtureSettings: ProviderSettings = {
  version: "synthetic-lesson-review",
  llmModel: "synthetic/reviewer",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 120000,
  maxOutputTokens: 3000,
  timeoutMs: 1000,
  maximumMicros: 1000,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};

/** A real class run and source-linked version, with no provider calls or shared-queue claims. */
export async function lessonReviewFixture(db: Database) {
  const x = await studyFixture(db);
  await updateProfile(
    db,
    x.ctx,
    { field: "level_goal", level: "A2", goal: "general" },
    { now: x.now },
  );
  const provider: AiProvider = {
    name: "synthetic",
    mode: "mock",
    settings: lessonReviewFixtureSettings,
    async structured() {
      throw new Error("Fixture creation must not call a provider");
    },
    async transcribe() {
      throw new Error("Fixture creation must not transcribe");
    },
    async speech() {
      throw new Error("Fixture creation must not create speech");
    },
  };
  const source = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "pdf",
      declared_mime: "application/pdf",
      verified_mime: "application/pdf",
      page_count: 2,
      size_bytes: 1000,
      sha256: "b".repeat(64),
      display_name: "Synthetic review lesson.pdf",
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: x.now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: source.id,
      role: "class_material",
      selected: true,
      ranges: JSON.stringify([{ start: 1, end: 1 }]),
    })
    .execute();
  const contentVersionId = await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, source.id, {
      schemaVersion: "1",
      provenance: "machine_extraction",
      originKey: `synthetic-review:${source.id}`,
      settings: { ranges: [] },
      units: [
        { id: "page-1", kind: "page", start: 1, status: "extracted" },
        { id: "page-2", kind: "page", start: 2, status: "extracted" },
      ],
      blocks: [
        {
          id: "selected",
          kind: "paragraph",
          unitId: "page-1",
          text: "We use the present perfect to connect past events to the present.",
        },
        {
          id: "unselected",
          kind: "paragraph",
          unitId: "page-2",
          text: "UNSELECTED_PRIVATE_PAGE_DO_NOT_SEND",
        },
      ],
    }),
  );
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(x.now.getTime() - 1000),
    endsAt: new Date(x.now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic lesson evaluator verification",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-lesson-review",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic lesson evaluator verification" },
  );
  const classRun = await createProcessingRun(
    db,
    x.ctx,
    {
      sessionId: x.session.id,
      operationKey: randomUUID(),
    },
    { provider, job: processingJob({ provider, store: new MemoryObjectStore() }) },
  );
  const row = await db
    .selectFrom("proc.processing_run")
    .select(["input_snapshot", "job_id"])
    .where("id", "=", classRun.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  const model = syntheticKnowledge(2);
  model.summary = [
    {
      id: "summary",
      text: "The present perfect connects past events to the present.",
      origin: "from_class",
      creation: "ai_generation",
      evidence: "material",
      sourceRefs: [
        {
          sourceId: source.id,
          contentVersionId,
          locator: { kind: "page", page: 1, blockId: "selected" },
        },
      ],
      speakerRole: "unknown",
      uncertain: false,
    },
  ];
  const knowledge = await db.transaction().execute(async (tx) => {
    const version = await publishKnowledgeVersion(tx, x.ctx, {
      runId: classRun.id,
      sessionId: x.session.id,
      sourcesVersion: snapshot.sourcesVersion,
      sourceFingerprint: snapshot.fingerprint,
      model,
      sources: snapshot.sources,
      explanationLanguage: "en",
      generation: { provider: "synthetic", mode: "mock" },
    });
    await settleAllowance(tx, x.ctx, classRun.reservationId, amounts({}));
    await tx
      .updateTable("proc.processing_run")
      .set({
        state: "ready",
        output_version_id: version.id,
        finished_at: new Date(),
      })
      .where("id", "=", classRun.id)
      .execute();
    if (row.job_id) await cancelJob(tx, row.job_id, new Date());
    return version;
  });
  return {
    ...x,
    knowledge,
    model,
    sourceId: source.id,
    contentVersionId,
    classRun,
    snapshot,
    settings: lessonReviewFixtureSettings,
  };
}
