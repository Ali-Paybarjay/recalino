import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs, runFixtureProcessingJobs } from "../../test/processing-jobs";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
} from "../aip";
import { createDatabase } from "../db";
import type { KnowledgeModel } from "../lkm";
import { createSession } from "../org";
import { MemoryObjectStore } from "../plt";
import {
  allowance,
  amounts,
  closeEntitlement,
  configureCostPolicy,
  grantEntitlement,
  returnedCharge,
} from "../quota";
import { appendContentVersion, updateSourceSelection } from "../src";
import { returnDuplicateClassCharges } from "./charged-material";
import {
  cleanupSourceProcessing,
  createProcessingRun,
  getRun,
  markSourceProcessingForCleanup,
} from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, runIds);
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
/** Synthetic generation that cites the first selected block; no network AI is used. */
class FixtureProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
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
    if (!source || !block) throw new Error("Fixture expected selected source evidence");
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
              sourceId: source.sourceId,
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
      output: input.schema.parse({ ...model, sourceClassifications: [] }),
      requestId: "synthetic-generation",
      model: input.model,
      provider: this.name,
      actualMicros: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(): Promise<ProviderResult<Transcript>> {
    throw new Error("Fixture has no audio");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("Fixture has no speech");
  }
}
const provider = new FixtureProvider();
const job = processingJob({ provider, store: new MemoryObjectStore() });

async function learner(allowanceUnits = amounts({ document: 10, regeneration: 10 })) {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(db, ctx, change, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const entitlementId = await grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: allowanceUnits,
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic D59 fixture",
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
    { actorId: "synthetic-operator", reason: "Synthetic D59 fixture" },
  );
  return { ctx, entitlementId };
}
async function classSession(ctx: { userId: string; requestId: string }) {
  return createSession(db, ctx, {}, { key: randomUUID() });
}
/** One verified, extracted text file of exactly one equivalent page. */
async function addText(
  ctx: { userId: string; requestId: string },
  sessionId: string,
  sha256: string,
) {
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 15,
      sha256,
      display_name: "Synthetic.txt",
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
      user_id: ctx.userId,
      session_id: sessionId,
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
  return asset.id;
}
async function publish(ctx: { userId: string; requestId: string }, sessionId: string) {
  const run = await createProcessingRun(
    db,
    ctx,
    { sessionId, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  const reserved = (await allowance(db, ctx)).reserved;
  await runFixtureProcessingJobs(db, job, { userId: ctx.userId, sessionId });
  expect((await getRun(db, ctx, run.id)).state).toBe("ready");
  return { run, reserved };
}
async function chargeMarkers(runId: string) {
  const rows = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", runId)
    .where("step", "like", "charge:%")
    .execute();
  return rows.map((row) => row.step).sort();
}
async function deselect(
  ctx: { userId: string; requestId: string },
  sessionId: string,
  assetId: string,
) {
  await updateSourceSelection(db, ctx, sessionId, assetId, {
    role: "class_material",
    selected: false,
    ranges: [],
    timeStatus: "unknown",
    contentVersionId: null,
  });
}
/** Make a D59 publication look like one settled by the pre-D59 worker: no charge markers. */
async function asLegacy(runId: string) {
  await db
    .deleteFrom("proc.run_step")
    .where("run_id", "=", runId)
    .where("step", "like", "charge:%")
    .execute();
}

const fileA = "1".repeat(64);
const fileB = "2".repeat(64);

describe("D59: class material is charged once (FR-QUOTA-005, FR-QUOTA-006)", () => {
  it("charges only new material when a class is updated, and its reservation fits the remainder", async () => {
    const { ctx } = await learner(amounts({ document: 1, regeneration: 5 }));
    const session = await classSession(ctx);
    await addText(ctx, session.id, fileA);
    await publish(ctx, session.id);
    expect((await allowance(db, ctx)).consumed.document).toBe(1);
    // Before D59 the update reserved both files again and was blocked with no pages left.
    const second = await addText(ctx, session.id, fileB);
    await expect(publish(ctx, session.id)).rejects.toMatchObject({
      code: "quota_insufficient",
      details: { required: { document: 1 }, remaining: { document: 0 } },
    });
    await deselect(ctx, session.id, second);
    // Republishing what the class already paid for reserves only the regeneration.
    const update = await publish(ctx, session.id);
    expect(update.reserved).toMatchObject({ document: 0, regeneration: 1 });
    expect((await allowance(db, ctx)).consumed).toMatchObject({ document: 1, regeneration: 1 });
  });

  it("does not charge the same file again in another class of the same allowance period", async () => {
    const { ctx } = await learner(amounts({ document: 1, regeneration: 5 }));
    const first = await classSession(ctx);
    await addText(ctx, first.id, fileA);
    await publish(ctx, first.id);
    const second = await classSession(ctx);
    await addText(ctx, second.id, fileA);
    const copy = await publish(ctx, second.id);
    expect(copy.reserved.document).toBe(0);
    expect((await allowance(db, ctx)).consumed.document).toBe(1);
    // Different content is still charged.
    const third = await classSession(ctx);
    await addText(ctx, third.id, fileB);
    await expect(publish(ctx, third.id)).rejects.toMatchObject({ code: "quota_insufficient" });
  });

  it("charges the same file in a new class of a new period, but never again in its own class", async () => {
    const { ctx, entitlementId } = await learner(amounts({ document: 5, regeneration: 5 }));
    const first = await classSession(ctx);
    await addText(ctx, first.id, fileA);
    await publish(ctx, first.id);
    await closeEntitlement(db, {
      userId: ctx.userId,
      entitlementId,
      actorId: "synthetic-operator",
      reason: "Synthetic period end",
    });
    await grantEntitlement(db, {
      userId: ctx.userId,
      startsAt: new Date(Date.now() - 500),
      endsAt: new Date(Date.now() + 3600000),
      amounts: amounts({ document: 5, regeneration: 5 }),
      operationKey: randomUUID(),
      actorId: "synthetic-operator",
      reason: "Synthetic next period",
    });
    expect((await publish(ctx, first.id)).reserved).toMatchObject({ document: 0 });
    const later = await classSession(ctx);
    await addText(ctx, later.id, fileA);
    expect((await publish(ctx, later.id)).reserved).toMatchObject({ document: 1 });
  });

  it("treats a run settled before D59 as paid, and keeps that when another file is deleted", async () => {
    const { ctx } = await learner(amounts({ document: 2, regeneration: 5 }));
    const session = await classSession(ctx);
    const kept = await addText(ctx, session.id, fileA);
    const removed = await addText(ctx, session.id, fileB);
    const { run } = await publish(ctx, session.id);
    expect(await chargeMarkers(run.id)).toEqual([`charge:${kept}`, `charge:${removed}`].sort());
    await asLegacy(run.id);
    // Deleting one file removes run snapshots; what the class paid for the other file remains.
    await db
      .transaction()
      .execute((tx) => markSourceProcessingForCleanup(tx, ctx, removed, [session.id]));
    await cleanupSourceProcessing(db, ctx, removed);
    expect(await chargeMarkers(run.id)).toEqual([`charge:${kept}`]);
    await deselect(ctx, session.id, removed);
    expect((await publish(ctx, session.id)).reserved).toMatchObject({
      document: 0,
      regeneration: 1,
    });
    expect((await allowance(db, ctx)).consumed.document).toBe(2);
  });

  it("returns duplicate pre-D59 charges once, in settlement order, as an audited operator correction", async () => {
    const { ctx } = await learner(amounts({ document: 10, regeneration: 5 }));
    const first = await classSession(ctx);
    await addText(ctx, first.id, fileA);
    const original = await publish(ctx, first.id);
    // Simulate the old worker: hide the first class while the second charges its copy in full.
    await asLegacy(original.run.id);
    await db
      .updateTable("proc.processing_run")
      .set({ state: "failed" })
      .where("id", "=", original.run.id)
      .execute();
    const second = await classSession(ctx);
    await addText(ctx, second.id, fileA);
    const duplicate = await publish(ctx, second.id);
    await asLegacy(duplicate.run.id);
    await db
      .updateTable("proc.processing_run")
      .set({ state: "ready" })
      .where("id", "=", original.run.id)
      .execute();
    expect((await allowance(db, ctx)).consumed.document).toBe(2);
    const command = { actorId: "synthetic-operator", reason: "Synthetic D59 correction" };
    const preview = await returnDuplicateClassCharges(db, ctx, { ...command, apply: false });
    expect(preview).toEqual([
      {
        runId: duplicate.run.id,
        sessionId: second.id,
        reservationId: duplicate.run.reservationId,
        returned: amounts({ document: 1 }),
      },
    ]);
    expect((await allowance(db, ctx)).consumed.document).toBe(2);
    expect(await returnDuplicateClassCharges(db, ctx, { ...command, apply: true })).toEqual(
      preview,
    );
    expect(await returnDuplicateClassCharges(db, ctx, { ...command, apply: true })).toEqual(
      preview,
    );
    const balance = await allowance(db, ctx);
    expect(balance.consumed.document).toBe(1);
    expect(balance.allocated.document).toBe(10);
    expect(balance.remaining.document).toBe(9);
    expect(await returnedCharge(db, ctx, duplicate.run.reservationId)).toEqual(
      amounts({ document: 1 }),
    );
    const audit = await db
      .selectFrom("plt.audit_event")
      .select(["action", "subject_id"])
      .where("action", "=", "quota.return_charge")
      .where("subject_id", "=", duplicate.run.reservationId)
      .execute();
    expect(audit).toHaveLength(1);
  });
});
