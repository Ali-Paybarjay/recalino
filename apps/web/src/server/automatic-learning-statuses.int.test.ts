import { randomUUID } from "node:crypto";
import type { AiProvider, ProviderSettings } from "@recalino/core/aip";
import { createDatabase, type Database } from "@recalino/core/db";
import { createSession, deleteSession } from "@recalino/core/org";
import { type LearnerContext, sha256Hex } from "@recalino/core/plt";
import {
  listRuns,
  processingQueue,
  requestAutomaticLearning,
  updateAutomaticLearningProgress,
} from "@recalino/core/proc";
import { amounts, configureCostPolicy, grantEntitlement } from "@recalino/core/quota";
import { appendContentVersion } from "@recalino/core/src";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import {
  automaticLearningSync,
  readAutomaticLearning,
  readAutomaticLearningStatuses,
} from "./automatic-learning";

// PERF-04: Today's statuses, read in bulk, equal each class's own status read, in a number of
// queries that does not grow with the classes. Synthetic data only.
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 3 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "statuses-fixture",
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
};
const refuse = async (): Promise<never> => {
  throw new Error("No provider call is expected while reading statuses");
};
// Runs are only queued here; no job runs, so the provider is never called.
const provider: AiProvider = {
  name: "synthetic",
  mode: "mock",
  settings,
  structured: refuse,
  transcribe: refuse,
  speech: refuse,
};

type Statement = Parameters<Parameters<Database["withPlugin"]>[0]["transformQuery"]>[0]["node"];
const ROW_LOCKS = ["ForUpdate", "ForNoKeyUpdate", "ForShare", "ForKeyShare"];
/** "select", a row-locking select such as "select ForUpdate", or the kind of a write. */
function statementKind(node: Statement): string {
  if (node.kind !== "SelectQueryNode") return node.kind;
  const locks = (node.endModifiers ?? []).flatMap((modifier) =>
    modifier.modifier && ROW_LOCKS.includes(modifier.modifier) ? [modifier.modifier] : [],
  );
  return ["select", ...locks].join(" ");
}

/**
 * Counts executed statements: Kysely calls transformResult once per executed query, while it
 * also calls transformQuery for each subquery built from this database. The kinds come from
 * every node, subqueries included, so a lock or a write anywhere is seen.
 */
function countingDatabase(database: Database) {
  const statements: string[] = [];
  let executed = 0;
  const counted = database.withPlugin({
    transformQuery(args) {
      statements.push(statementKind(args.node));
      return args.node;
    },
    async transformResult(args) {
      executed++;
      return args.result;
    },
  });
  return { db: counted, queries: () => executed, kinds: () => new Set(statements) };
}

async function learner() {
  const base = await studyFixture(db);
  const now = new Date();
  await grantEntitlement(db, {
    userId: base.ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Local status read test",
  });
  await configureCostPolicy(
    db,
    {
      version: "statuses-fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Local status read test" },
  );
  return base;
}

/** A class of this learner with one verified, selected text source. */
async function classWithText(ctx: LearnerContext, text: string) {
  const session = await createSession(db, ctx, {}, { key: randomUUID() });
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: text.length,
      sha256: sha256Hex(text),
      display_name: text,
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
      session_id: session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, ctx, asset.id, {
      originKey: randomUUID(),
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text }],
    }),
  );
  const started = await automaticLearningSync(db, ctx, session.id, {
    dependencies: { provider: () => provider, processing: () => processingQueue },
  });
  expect(started.state).toBe("processing");
  const run = (await listRuns(db, ctx, session.id))[0];
  if (!run) throw new Error("Expected a queued synthetic run");
  return { session, run, revision: started.revision };
}

it("PERF-04 reads Today's statuses in bulk exactly as each class reads its own", async () => {
  const base = await learner();
  const { ctx } = base;
  // A run whose lesson is written and waits for its voice check or publication.
  const writing = await classWithText(ctx, "Synthetic lesson being finished");
  await db
    .updateTable("proc.processing_run")
    .set({ state: "processing" })
    .where("id", "=", writing.run.id)
    .execute();
  await db
    .insertInto("proc.run_step")
    .values({ run_id: writing.run.id, step: "knowledge", output: "{}", completed_at: new Date() })
    .execute();
  // A failed run the learner can ask to have reviewed.
  const failed = await classWithText(ctx, "Synthetic lesson that failed");
  await db
    .updateTable("proc.processing_run")
    .set({ state: "failed", last_error: "provider_http_500" })
    .where("id", "=", failed.run.id)
    .execute();
  await updateAutomaticLearningProgress(db, ctx, failed.session.id, failed.revision, {
    state: "blocked",
    lastError: "provider_http_500",
    runId: failed.run.id,
  });
  const waiting = await createSession(db, ctx, {}, { key: randomUUID() });
  await requestAutomaticLearning(db, ctx, waiting.id, { changed: false });
  const idle = await createSession(db, ctx, {}, { key: randomUUID() });
  const deleted = await createSession(db, ctx, {}, { key: randomUUID() });
  await deleteSession(db, ctx, deleted.id);
  const foreign = await studyFixture(db);
  const ids = [
    base.session.id,
    writing.session.id,
    failed.session.id,
    waiting.id,
    idle.id,
    deleted.id,
    foreign.session.id,
  ];
  const single = countingDatabase(db);
  const expected = await Promise.all(
    ids.map((id) => readAutomaticLearning(single.db, ctx, id, () => provider).catch(() => null)),
  );
  expect(expected.slice(5)).toEqual([null, null]);
  expect(expected[0]?.notesReady).toBe(true);
  expect(expected[1]?.stage).toBeTruthy();
  expect(expected[2]?.processingReview?.canRequest).toBe(true);
  const counted = countingDatabase(db);
  expect(await readAutomaticLearningStatuses(counted.db, ctx, ids, () => provider)).toEqual(
    expected,
  );
  // Executed statements: sessions, intents, notes (three reads), runs, review requests and the
  // finishing stage (its written runs, then the voice enrollment), however many classes there are.
  expect(counted.queries()).toBeLessThanOrEqual(9);
  // Neither read writes. The class's own read locks its class row for one statement at a time
  // (assertSessionOwner, outside any transaction); the bulk read takes no row lock at all.
  expect([...single.kinds()].every((kind) => ["select", "select ForUpdate"].includes(kind))).toBe(
    true,
  );
  expect([...counted.kinds()]).toEqual(["select"]);
});

it("PERF-04 reads ten classes' statuses in at most eight queries, as many as for three", async () => {
  const base = await learner();
  const { ctx } = base;
  const classes = [base.session.id];
  for (let index = 0; index < 9; index++) {
    const session = await createSession(db, ctx, {}, { key: randomUUID() });
    if (index % 2) await requestAutomaticLearning(db, ctx, session.id, { changed: false });
    classes.push(session.id);
  }
  const ready = await classWithText(ctx, "Synthetic queued lesson");
  classes[9] = ready.session.id;
  const counts: number[] = [];
  for (const ids of [classes.slice(0, 3).concat(classes[9] as string), classes]) {
    const counted = countingDatabase(db);
    const statuses = await readAutomaticLearningStatuses(counted.db, ctx, ids, () => provider);
    expect(statuses).toEqual(
      await Promise.all(
        ids.map((id) => readAutomaticLearning(db, ctx, id, () => provider).catch(() => null)),
      ),
    );
    counts.push(counted.queries());
  }
  expect(counts[0]).toBeLessThanOrEqual(8);
  expect(counts[1]).toBe(counts[0]);
});
