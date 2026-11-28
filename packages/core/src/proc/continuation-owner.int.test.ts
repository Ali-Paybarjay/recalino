// P12-01 part A (C11-77 main builder, F-8 and R2-P1201-03; AC-15 to AC-20, AC-25, AC-27 and AC-30;
// owner answers to E553, E559 and E631): a processing job writes its run's pointer
// (proc.processing_run.job_id) only as the run's owner, with a valid claim, and only to the
// continuation it creates in the same transaction (checkpointAndContinue); a job that does not own
// its run starts no provider attempt and closes no live hold, for all three kinds (proc.process,
// proc.capture_transcription, proc.voice_analysis; liveRun); a responder that lost the run's
// ownership while its call was in flight accounts its own attempt once and writes no run result,
// checkpoint or callback (providerStep); and the existing ended-job reconciliation of main leaves
// the hold of a live owner's attempt in flight to that owner.
//
// Every job here is enqueued by the code under test and really claimed with a real lease; no
// test-only mark. The auxiliary jobs run through the real PLT runner (runDueJobs), as in P12-06's
// aux-continuation-owner.int.test.ts; a class job, whose payload names no subject a runner can be
// targeted to, is claimed on a queue kind of its own and takes its real kind back at once (as in
// the P11-02 tests), its lease renewed while its handler runs. A lease is lost by really running
// out on the database clock, and the real sweep returns or fails the job. A pointer is written
// directly only as injected state the job layer can no longer produce, each marked "Injected
// state": a legacy null pointer, a pointer another writer moved, and the pointer that leaves a
// responder whose call is in flight.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, expect, it, vi } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import {
  type AiProvider,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  type StructuredInput,
  type Transcript,
} from "../aip";
import { createDatabase, type Database, type Tx } from "../db";
import type { KnowledgeModel } from "../lkm";
import { createSession, renewCaptureLease } from "../org";
import {
  type ClaimedJob,
  cancelJob,
  claimJobs,
  completeJob,
  DEFAULT_PLT_SETTINGS,
  enqueueJob,
  JobCancelled,
  type JobContext,
  type JobDefinition,
  type LogValue,
  MemoryObjectStore,
  ownedObjectMetadata,
  renewJobLease,
  runDueJobs,
  runJobStep,
  sha256Hex,
  sweepJobs,
  writeOwnedObject,
} from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import {
  acceptSourceNotice,
  appendContentVersion,
  beginStagedAudioUpload,
  confirmTemporaryAudioPart,
  createSource,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "../src";
import {
  enableVoice,
  findVoiceAnalysis,
  hasRepeatableVoiceEvidence,
  type PrivateVoiceAnalysis,
  VOICE_CONSENT_VERSION,
} from "../voc";
import { captureTranscriptionJob, scheduleCaptureTranscription } from "./capture-transcription";
import { sourceSnapshotSchema } from "./contracts";
import { reconcileEndedJobRuns } from "./maintenance";
import { createProcessingRun } from "./runs";
import { scheduleVoiceReanalysis, voiceAnalysisJob } from "./voice-jobs";
import {
  analyzeVoiceSources,
  correctVoiceCandidates,
  processVoiceSource,
  scopedVoiceSpeakerId,
  type VoiceDiarization,
} from "./voice-processing";
import { type AudioPreparer, processingJob } from "./worker";

/** Short leases, so a lease really runs out within a test; every job here is enqueued with it. */
const LEASE_SECONDS = 3;
vi.stubEnv("PLT_SETTINGS_JSON", JSON.stringify({ jobs: { leaseSeconds: LEASE_SECONDS } }));

const db = createDatabase(testDatabaseUrl(), { maxConnections: 6 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    // Only this file's runs and jobs: nothing is left for another file's runner.
    if (runIds.length) {
      const jobs = await db
        .selectFrom("plt.job")
        .select("id")
        .where(sql<string>`payload->>'runId'`, "in", runIds)
        .execute();
      for (const job of jobs) await cancelJob(db, job.id, new Date());
    }
  } finally {
    vi.unstubAllEnvs();
    await db.destroy();
  }
});

const MINUTE = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const CLASS_NOT_OWNER = "processing_run_not_owner";
const AUX_NOT_OWNER = "auxiliary_run_not_owner";
const NOT_COMMITTED = "provider_result_not_committed";

type Logged = { event: string } & Record<string, LogValue>;
/** A provider answer held until the test's own step, run inside the provider call, is done. */
interface Gate {
  calls: number;
  hook?: () => Promise<void>;
  /** The provider's answer to the next structured call is this known failure, with its cost. */
  failWith?: (model: string) => ProviderError;
}
async function passGate(gate: Gate) {
  gate.calls++;
  const hook = gate.hook;
  gate.hook = undefined;
  await hook?.();
}

function syntheticSettings(version: string, contentContract = false): ProviderSettings {
  return {
    version,
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "1",
    maxInputCharacters: 120000,
    maxOutputTokens: 6144,
    timeoutMs: 1000,
    maximumMicros: 1000,
    currency: "USD",
    priceVersion: "fixture",
    charactersPerPage: 3000,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
    ...(contentContract
      ? { structuredModelOverrides: { "synthetic/llm": { knowledgeContract: "content" as const } } }
      : {}),
  };
}
const CALL_MICROS = 10;
/** A known paid failure of a lesson call: the provider's own code, with its cost. */
const knownFailure = (code: string) => (model: string) =>
  new ProviderError(code, false, false, {
    provider: "synthetic-owner",
    model,
    requestId: `synthetic-owner-${code}`,
    actualMicros: CALL_MICROS,
    usage: { inputTokens: 10, outputTokens: 10 },
  });

/** The class lesson, a transcript or the voice correction, each after the gate. */
function gatedProvider(settings: ProviderSettings, gate: Gate): AiProvider {
  return {
    name: "synthetic-owner",
    mode: "mock",
    settings,
    async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
      await passGate(gate);
      const failure = gate.failWith;
      gate.failWith = undefined;
      if (failure) throw failure(input.model);
      const data = JSON.parse(input.input);
      if (input.schemaName === "spoken_mistake_candidates") {
        const learner = data.utterances.find((item: { text: string }) =>
          item.text.includes("am agree"),
        );
        return {
          output: input.schema.parse({
            candidates: [
              {
                speakerId: learner.speakerId,
                mistakes: [
                  {
                    utteranceId: learner.id,
                    said: "I am agree with you.",
                    correct: "I agree with you.",
                    whyFa: "The verb agree does not need am.",
                    kind: "grammar",
                    teacherCorrected: false,
                  },
                ],
              },
            ],
          }),
          requestId: "synthetic-owner-correction",
          provider: "synthetic-owner",
          model: input.model,
          actualMicros: CALL_MICROS,
          usage: { inputTokens: 20, outputTokens: 20 },
        };
      }
      const source = data.sources?.[0];
      const block = source?.blocks?.[0];
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
                sourceId: source.sourceId,
                contentVersionId: source.contentVersionId,
                locator: {
                  kind: "text",
                  blockId: block.id,
                  start: 0,
                  end: Array.from(block.text as string).length,
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
        requestId: "synthetic-owner-generation",
        model: input.model,
        provider: "synthetic-owner",
        actualMicros: CALL_MICROS,
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
    async transcribe(input): Promise<ProviderResult<Transcript>> {
      await passGate(gate);
      const offsetMs = input.offsetMs ?? 0;
      return {
        output: {
          text: "Synthetic speech.",
          language: "en",
          segments: [
            {
              id: `${offsetMs}`,
              text: "Synthetic speech.",
              startMs: offsetMs,
              endMs: offsetMs + 1000,
              speakerId: null,
              speakerRole: "unknown",
            },
          ],
        },
        requestId: "synthetic-owner-transcript",
        provider: "synthetic-owner",
        model: input.model,
        actualMicros: CALL_MICROS,
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
    async speech(): Promise<never> {
      throw new Error("No speech in this fixture");
    },
  };
}

async function allowanceFor(userId: string, granted: Parameters<typeof amounts>[0]) {
  await grantEntitlement(db, {
    userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 24 * 3600 * 1000),
    amounts: amounts(granted),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic continuation owner integration",
  });
}
async function costPolicy() {
  await configureCostPolicy(
    db,
    {
      version: "synthetic-owner",
      currency: "USD",
      killSwitch: false,
      limits: { session: 1e8, userMonth: 1e8, systemDay: 1e8, systemMonth: 1e8 },
    },
    { actorId: "synthetic", reason: "Synthetic continuation owner integration" },
  );
}

// ---------------------------------------------------------------------------------------------
// proc.process: a class run over one selected text source.

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

type ClassPayload = { runId: string; userId: string };
/** With `contentContract`, the lesson uses the content-only knowledge contract. */
async function classSubject(options: { contentContract?: boolean } = {}) {
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
  await allowanceFor(ctx.userId, { document: 100, regeneration: 100, audio: 100 });
  await costPolicy();
  const gate: Gate = { calls: 0 };
  const provider = gatedProvider(
    syntheticSettings("synthetic-owner", options.contentContract ?? false),
    gate,
  );
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  /** The same kind with provider settings that no longer match the run's: a real error. */
  const broken = processingJob({
    provider: gatedProvider(syntheticSettings("synthetic-owner-changed"), gate),
    store: new MemoryObjectStore(),
  });
  const run = await createProcessingRun(
    db,
    ctx,
    { sessionId: session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  return { ctx, runId: run.id, gate, job, broken };
}
type ClassSubject = Awaited<ReturnType<typeof classSubject>>;

/**
 * One class job, really claimed: on a queue kind of its own (made due now) so no other file's job
 * is taken, then its real kind back at once, as in production, so its singleton key and PLT's own
 * read see it. Its lease is renewed while its handler runs, unless `renew` is false.
 */
async function claimClass(
  s: { job: JobDefinition<ClassPayload> },
  jobId: string,
  options: {
    deadline?: Date;
    definition?: JobDefinition<ClassPayload>;
    renew?: boolean;
    /** The database the handler writes through (the AC-33 replay seam); the same one otherwise. */
    db?: Database;
  } = {},
) {
  const kind = `proc.synthetic_${randomUUID().replaceAll("-", "")}`;
  await db
    .updateTable("plt.job")
    .set({ kind, run_at: new Date(Date.now() - 1000) })
    .where("id", "=", jobId)
    .execute();
  const [claim] = await claimJobs(db, [kind], 1, new Date());
  await db.updateTable("plt.job").set({ kind: s.job.kind }).where("id", "=", jobId).execute();
  if (!claim || claim.id !== jobId || claim.generation === undefined)
    throw new Error("Expected a claim of the job");
  const logs: Logged[] = [];
  const context: JobContext = {
    db: options.db ?? db,
    now: () => new Date(),
    job: { id: claim.id, attempt: claim.attempt },
    lease: { id: claim.id, token: claim.token, generation: claim.generation },
    step: (name, effect) => runJobStep(db, claim, name, effect, new Date()),
    log: (_level, event, fields) => {
      logs.push({ ...fields, event });
    },
    ...(options.deadline ? { deadline: options.deadline } : {}),
  };
  const definition = options.definition ?? s.job;
  const run = async () => {
    const timer =
      options.renew === false
        ? undefined
        : setInterval(() => {
            void renewJobLease(db, claim, new Date()).catch(() => undefined);
          }, 500);
    try {
      await definition.run(definition.payload.parse(claim.payload), context);
    } finally {
      clearInterval(timer);
    }
  };
  return { claim, logs, run, standAsides: () => logs.filter((l) => l.event === CLASS_NOT_OWNER) };
}
/** Too little time for a lesson call: the class job hands the run on to a continuation. */
const short = () => ({ deadline: new Date(Date.now() + 1000) });

/** Waits, reading only, until the job's lease has run out on the database clock. */
async function leaseEnded(jobId: string): Promise<void> {
  for (let tries = 0; tries < 150; tries++) {
    const { rows } = await sql<{ ended: boolean }>`
      select lease_until is null or lease_until < statement_timestamp() as ended
      from plt.job where id = ${jobId}`.execute(db);
    if (rows[0]?.ended) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected the lease to run out");
}
/** The claim's authority ends before its completeJob: the lease runs out, the sweep returns it. */
async function loseLease(claim: Pick<ClaimedJob, "id">) {
  await leaseEnded(claim.id);
  await sweepJobs(db, new Date());
}

/** What a job could change: the run and its pointer, its jobs, checkpoints, attempts and holds. */
async function observe(runId: string) {
  const run = await db
    .selectFrom("proc.processing_run")
    .select(["job_id", "state", "last_error", "reservation_id"])
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  const jobs = await db
    .selectFrom("plt.job")
    .select(["id", "state", "singleton_key", "lease_token"])
    .where(sql<string>`payload->>'runId'`, "=", runId)
    .orderBy("created_at")
    .execute();
  const steps = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", runId)
    .orderBy("step")
    .execute();
  const attempts = (
    await db
      .selectFrom("proc.provider_attempt as a")
      .innerJoin("quota.cost_hold as h", "h.id", "a.hold_id")
      .select([
        "a.id as id",
        "a.step as step",
        "a.state as state",
        "a.error_code as errorCode",
        "h.closed_at as closedAt",
      ])
      .where("a.run_id", "=", runId)
      .orderBy("a.started_at")
      .execute()
  ).map((row) => ({ ...row, closedAt: row.closedAt === null ? null : new Date(row.closedAt) }));
  const costs = (
    await db
      .selectFrom("quota.provider_cost")
      .select(["attempt_id", "amount_micros", "estimated_micros"])
      .where("run_id", "=", runId)
      .execute()
  ).map((row) => ({
    attemptId: row.attempt_id,
    amount: row.amount_micros === null ? null : Number(row.amount_micros),
    estimated: row.estimated_micros === null ? null : Number(row.estimated_micros),
  }));
  const job = (id: string | null | undefined) => jobs.find((item) => item.id === id);
  return {
    pointer: run.job_id,
    state: run.state,
    lastError: run.last_error,
    jobs,
    job,
    steps: steps.map((row) => row.step),
    attempts,
    costs,
  };
}
type Observed = Awaited<ReturnType<typeof observe>>;
type Attempt = Observed["attempts"][number];
const pointerOf = async (runId: string) => {
  const { pointer } = await observe(runId);
  if (!pointer) throw new Error("Expected the run's pointer");
  return pointer;
};
/** A checkpoint's saved content, not only its name. */
async function stepOutput(runId: string, step: string): Promise<unknown> {
  const row = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", runId)
    .where("step", "=", step)
    .executeTakeFirst();
  return row?.output;
}
/** The one attempt whose hold is still open: the call in flight. */
function inFlightAttempt(observed: Observed): Attempt {
  const open = observed.attempts.filter((row) => row.closedAt === null);
  expect(open).toHaveLength(1);
  const attempt = open[0] as Attempt;
  expect(attempt.state).toBe("started");
  expect(observed.costs.filter((row) => row.attemptId === attempt.id)).toEqual([]);
  return attempt;
}
/** The run's own facts and its jobs (ids and states), as a job could change them. */
function runFacts(observed: Observed) {
  return {
    pointer: observed.pointer,
    state: observed.state,
    lastError: observed.lastError,
    steps: observed.steps,
    jobs: observed.jobs.map((row) => ({ id: row.id, state: row.state })),
  };
}

/**
 * The existing ended-job reconciliation of main, run while a live owner's attempt is in flight
 * (AC-19): before it, the attempt is started, its hold open and it has no cost row; after it, the
 * same attempt and hold are still open, no cost row is written and the run is not changed.
 */
async function reconcileKeepsLiveHold(runId: string, userId: string) {
  const open = await observe(runId);
  const attempt = inFlightAttempt(open);
  await reconcileEndedJobRuns(db, new Date(), { userId });
  const after = await observe(runId);
  expect(after.attempts).toEqual(open.attempts);
  expect(after.costs).toEqual(open.costs);
  expect(after.costs.filter((row) => row.attemptId === attempt.id)).toEqual([]);
  expect(runFacts(after)).toEqual(runFacts(open));
  return attempt.id;
}
/** The owner's own settle: the attempt resolved, one row at the real amount, the hold closed. */
async function expectNormalSettle(runId: string, attemptId: string) {
  const after = await observe(runId);
  const attempt = after.attempts.find((row) => row.id === attemptId);
  expect(attempt?.state).toBe("succeeded");
  expect(attempt?.closedAt).not.toBeNull();
  expect(after.costs.filter((row) => row.attemptId === attemptId)).toEqual([
    { attemptId, amount: CALL_MICROS, estimated: null },
  ]);
  return attempt as Attempt;
}
/** Run again after the settle: the reconciliation writes no second row for the attempt. */
async function expectNoSecondRow(runId: string, userId: string, attemptId: string) {
  const settled = await observe(runId);
  await reconcileEndedJobRuns(db, new Date(), { userId });
  const after = await observe(runId);
  expect(after.costs).toEqual(settled.costs);
  expect(after.costs.filter((row) => row.attemptId === attemptId)).toHaveLength(1);
}

/**
 * Injected state (AC-33): the new owner's own checkpoint of the responder's step, with content no
 * responder could write (it names the attempt and a fresh marker). Returns that content.
 */
async function injectOwnerCheckpoint(runId: string, attempt: Attempt): Promise<unknown> {
  const content = { newOwnerCheckpoint: randomUUID(), step: attempt.step, attempt: attempt.id };
  await db
    .insertInto("proc.run_step")
    .values({
      run_id: runId,
      step: attempt.step,
      output: JSON.stringify(content),
      completed_at: new Date(),
    })
    .execute();
  return content;
}
/** Injected state: the run's pointer, as a writer the job layer can no longer produce sets it. */
async function injectPointer(runId: string, to: string | null) {
  await db.updateTable("proc.processing_run").set({ job_id: to }).where("id", "=", runId).execute();
}
/** Another job of the same run (an injected owner), due much later, so no runner here takes it. */
async function anotherClassJob(s: {
  job: JobDefinition<ClassPayload>;
  runId: string;
  ctx: { userId: string };
}): Promise<string> {
  const id = await db.transaction().execute((tx) =>
    enqueueJob(tx, s.job, {
      payload: { runId: s.runId, userId: s.ctx.userId },
      singletonKey: `${s.runId}:another-writer`,
      now: new Date(),
      runAt: new Date(Date.now() + 48 * 60 * MINUTE),
      defaults: DEFAULT_PLT_SETTINGS.jobs,
    }),
  );
  if (!id) throw new Error("Expected the other writer's job");
  return id;
}

/** J hands the run on to J2 as its owner, and its authority ends before its completeJob. */
async function handedOn(s: ClassSubject) {
  const first = await pointerOf(s.runId);
  const j = await claimClass(s, first, short());
  await j.run();
  const handed = await observe(s.runId);
  const second = handed.pointer;
  if (!second || second === first) throw new Error("Expected the continuation on the pointer");
  expect(handed.job(second)?.singleton_key).toBe(`${s.runId}:${first}`);
  expect(handed.jobs).toHaveLength(2);
  expect(j.standAsides()).toEqual([]);
  await loseLease(j.claim);
  expect(handed.job(first)).toBeTruthy();
  expect((await observe(s.runId)).job(first)?.state).toBe("retry_scheduled");
  return { first, second };
}

it(
  "continuation owner proc.process: retry after the continuation keeps the pointer",
  async () => {
    const s = await classSubject();
    const { first, second } = await handedOn(s);
    const before = await observe(s.runId);
    // J, claimed again, reaches the same builder's run: it does not own the run and stands aside.
    const retry = await claimClass(s, first, short());
    expect(retry.claim.attempt).toBe(2);
    await retry.run();
    expect(await completeJob(db, retry.claim, new Date())).toBe(true);
    const after = await observe(s.runId);
    expect(after.pointer).toBe(second);
    expect(after.job(second)?.state).toBe("queued");
    expect(after.jobs.map((row) => row.id)).toEqual(before.jobs.map((row) => row.id));
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(after.steps).toEqual(before.steps);
    expect(after.attempts).toEqual([]);
    expect(s.gate.calls).toBe(0);
    // A valid non-owner ends as a success with nothing done, and says so once.
    expect(after.job(first)?.state).toBe("succeeded");
    expect(retry.standAsides()).toEqual([
      expect.objectContaining({ job_id: first, attempt: 2, code: "not_owner", reason: "live_run" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "continuation owner proc.process: J2 to J3 chain keeps the pointer on the live continuation",
  async () => {
    const s = await classSubject();
    const { first, second } = await handedOn(s);
    // J2 runs as the owner and hands on to J3; its authority then ends too.
    const j2 = await claimClass(s, second, short());
    await j2.run();
    expect(j2.standAsides()).toEqual([]);
    const third = await pointerOf(s.runId);
    expect([first, second]).not.toContain(third);
    const chained = await observe(s.runId);
    expect(chained.job(third)?.singleton_key).toBe(`${s.runId}:${second}`);
    expect(chained.jobs).toHaveLength(3);
    await loseLease(j2.claim);
    // Both earlier jobs are claimed again; neither moves the pointer back.
    const stood: Logged[] = [];
    for (const id of [first, second]) {
      const retry = await claimClass(s, id, short());
      await retry.run();
      expect(await completeJob(db, retry.claim, new Date())).toBe(true);
      stood.push(...retry.standAsides());
    }
    const after = await observe(s.runId);
    expect(after.pointer).toBe(third);
    expect(after.job(third)?.state).toBe("queued");
    expect(after.jobs.map((row) => row.id)).toEqual(chained.jobs.map((row) => row.id));
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(stood.map((line) => line.job_id)).toEqual([first, second]);
    // The live continuation still carries the run on as its owner: it dispatches the lesson.
    const owner = await claimClass(s, third);
    await owner.run();
    expect(await completeJob(db, owner.claim, new Date())).toBe(true);
    expect(owner.standAsides()).toEqual([]);
    const carried = await observe(s.runId);
    expect(s.gate.calls).toBe(1);
    expect(carried.attempts.map((row) => row.state)).toEqual(["succeeded"]);
    expect(carried.lastError).toBeNull();
  },
  TEST_TIMEOUT_MS,
);

it(
  "continuation owner proc.process: zombie with the same id and a stale lease writes nothing",
  async () => {
    const s = await classSubject();
    const zombieId = await pointerOf(s.runId);
    const zombie = await claimClass(s, zombieId, { ...short(), renew: false });
    // Its lease runs out; the sweep and claim B take the same job before the zombie acts.
    await loseLease(zombie.claim);
    const b = await claimClass(s, zombieId);
    expect(b.claim.id).toBe(zombieId);
    const before = await observe(s.runId);
    await zombie.run();
    const after = await observe(s.runId);
    expect(after.pointer).toBe(zombieId);
    expect(after.state).toBe(before.state);
    expect(after.lastError).toBeNull();
    expect(after.steps).toEqual(before.steps);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.jobs.map((row) => row.id)).toEqual([zombieId]);
    // Claim B is untouched: the zombie forced no state on the job.
    expect(after.job(zombieId)).toMatchObject({ state: "running", lease_token: b.claim.token });
    expect(zombie.standAsides()).toEqual([]);
    expect(s.gate.calls).toBe(0);
  },
  TEST_TIMEOUT_MS,
);

it(
  "continuation owner proc.process: the zero-row pointer case stops at the early guard and commits no continuation and no checkpoint",
  async () => {
    const s = await classSubject();
    const j = await pointerOf(s.runId);
    // Injected state: another writer moved the pointer to a job of the same run, due later.
    const sibling = await anotherClassJob(s);
    await injectPointer(s.runId, sibling);
    const before = await observe(s.runId);
    // J, with a valid claim, finds in its first transaction (liveRun, the early guard) that the
    // pointer is not its own: it stops there, before checkpointAndContinue's conditional write
    // could change zero rows, and nothing of it commits.
    const own = await claimClass(s, j, short());
    await own.run();
    expect(await completeJob(db, own.claim, new Date())).toBe(true);
    const after = await observe(s.runId);
    expect(after.pointer).toBe(sibling);
    expect(after.jobs.map((row) => row.id)).toEqual([j, sibling]);
    expect(after.jobs.some((row) => row.singleton_key === `${s.runId}:${j}`)).toBe(false);
    expect(after.steps).toEqual(before.steps);
    expect(after.state).toBe(before.state);
    expect(after.lastError).toBeNull();
    expect(after.attempts).toEqual([]);
    expect(after.job(j)?.state).toBe("succeeded");
    expect(own.standAsides()).toEqual([
      expect.objectContaining({ job_id: j, code: "not_owner", reason: "live_run" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "continuation owner proc.process: valid owner moves the pointer and still fails the run on a real error",
  async () => {
    const s = await classSubject();
    const first = await pointerOf(s.runId);
    const j = await claimClass(s, first, short());
    await j.run();
    expect(await completeJob(db, j.claim, new Date())).toBe(true);
    const handed = await observe(s.runId);
    const second = handed.pointer;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(handed.job(second)?.singleton_key).toBe(`${s.runId}:${first}`);
    expect(handed.state).toBe("processing");
    expect(j.standAsides()).toEqual([]);
    // The owner's real error fails the run and releases its hold, as before.
    const failing = await claimClass(s, second as string, { definition: s.broken });
    await failing.run();
    expect(await completeJob(db, failing.claim, new Date())).toBe(true);
    expect(failing.standAsides()).toEqual([]);
    const after = await observe(s.runId);
    expect(after.state).toBe("failed");
    expect(after.lastError).not.toBeNull();
    expect(after.pointer).toBe(second);
    expect(after.attempts).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "legacy null pointer proc.process: no takeover, no fail, no new attempt, no close for the ambiguity",
  async () => {
    const s = await classSubject();
    const j = await pointerOf(s.runId);
    // J, the owner, dispatches the lesson; its lease runs out during the call, so its commit is
    // refused: the attempt stays started and its hold open.
    const owner = await claimClass(s, j, { renew: false });
    s.gate.hook = () => loseLease(owner.claim);
    await owner.run();
    const left = await observe(s.runId);
    expect(left.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    expect(left.costs).toEqual([]);
    // Injected state: data older code left (C11-77), the live run's pointer is empty.
    await injectPointer(s.runId, null);
    const before = await observe(s.runId);
    // J, claimed again with a valid lease, proves no ownership: it takes nothing over, fails
    // nothing, starts no attempt and does not close the started attempt's hold.
    const retry = await claimClass(s, j);
    expect(retry.claim.attempt).toBe(2);
    await retry.run();
    expect(await completeJob(db, retry.claim, new Date())).toBe(true);
    const after = await observe(s.runId);
    expect(after.pointer).toBeNull();
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(after.steps).toEqual(before.steps);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.costs).toEqual([]);
    expect(after.jobs.map((row) => row.id)).toEqual([j]);
    expect(s.gate.calls).toBe(1);
    expect(retry.standAsides()).toEqual([
      expect.objectContaining({ job_id: j, code: "not_owner", reason: "live_run" }),
    ]);
    // AC-20: the existing reconciliation of main then changes none of it either: the pointer, the
    // run, the attempt, its hold and the cost rows are as they were.
    const reconciled = await observe(s.runId);
    await reconcileEndedJobRuns(db, new Date(), { userId: s.ctx.userId });
    const last = await observe(s.runId);
    expect(last.pointer).toBeNull();
    expect(runFacts(last)).toEqual(runFacts(reconciled));
    expect(last.attempts).toEqual(before.attempts);
    expect(last.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    expect(last.costs).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

/**
 * J2, the owner, holds its paid lesson call; inside that call J's retry, really claimed, stands
 * aside, and with `reconcile` the existing reconciliation runs too. The answer then arrives.
 */
async function classInFlight(reconcile: boolean) {
  const s = await classSubject();
  const { first, second } = await handedOn(s);
  const j2 = await claimClass(s, second);
  let during: { attempts: Observed["attempts"]; stood: Logged[] } | undefined;
  let attemptId = "";
  s.gate.hook = async () => {
    const open = await observe(s.runId);
    const retry = await claimClass(s, first);
    await retry.run();
    expect(await completeJob(db, retry.claim, new Date())).toBe(true);
    during = { attempts: (await observe(s.runId)).attempts, stood: retry.standAsides() };
    expect(during.attempts).toEqual(open.attempts);
    if (reconcile) attemptId = await reconcileKeepsLiveHold(s.runId, s.ctx.userId);
  };
  await j2.run();
  expect(await completeJob(db, j2.claim, new Date())).toBe(true);
  return { s, first, second, during, attemptId };
}

it(
  "attempt guard proc.process: a non-owner starts no provider attempt and closes no live hold",
  async () => {
    const { s, first, second, during } = await classInFlight(false);
    // While J2's call was in flight: one attempt, J2's, its hold open; J started none.
    expect(during?.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    expect(during?.stood).toEqual([
      expect.objectContaining({ job_id: first, code: "not_owner", reason: "live_run" }),
    ]);
    // J2 kept the run (or handed it on itself, as its owner); only J2 called the provider.
    const after = await observe(s.runId);
    const ownChain = after.jobs.filter((row) => row.singleton_key === `${s.runId}:${second}`);
    expect([second, ...ownChain.map((row) => row.id)]).toContain(after.pointer);
    expect(after.jobs.filter((row) => row.singleton_key === `${s.runId}:${first}`)).toHaveLength(1);
    expect(after.lastError).toBeNull();
    expect(s.gate.calls).toBe(1);
    expect(after.attempts.map((row) => row.state)).toEqual(["succeeded"]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "in-flight proc.process: provider waits, reconcile runs, the response arrives: one accounting and no wrong close",
  async () => {
    const { s, during, attemptId } = await classInFlight(true);
    expect(during?.stood).toHaveLength(1);
    expect(attemptId).not.toBe("");
    const attempt = await expectNormalSettle(s.runId, attemptId);
    const after = await observe(s.runId);
    expect(after.costs).toHaveLength(1);
    expect(after.lastError).toBeNull();
    // The owner's checkpoint holds the lesson it bought, and its callback saved its context.
    expect(attempt.step).toBe("knowledge");
    expect(JSON.stringify(await stepOutput(s.runId, "knowledge"))).toContain("Synthetic class");
    expect(after.steps).toContain("knowledge:input-context");
    // The reconciliation run again after the response writes no second row.
    await expectNoSecondRow(s.runId, s.ctx.userId, attemptId);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The response guard of proc.process (AC-27, AC-30): the responder, really claimed and the run's
// owner, starts its attempt; while its call is in flight its ownership goes (injected state); its
// lease stays valid; the answer then arrives.

/** The responder's run, with the pointer moved away while its call is in flight. */
async function classResponseAway(
  to: "another" | "null",
  options: {
    contentContract?: boolean;
    failWith?: (model: string) => ProviderError;
    /** The handler's database (the AC-33 replay seam). */
    db?: Database;
    /** The new owner already has its own, distinct checkpoint of the responder's step (AC-33). */
    ownerCheckpoint?: boolean;
    /** Called inside the responder's call, before its ownership goes (AC-33: arms the replay). */
    onCall?: (runId: string) => void;
  } = {},
) {
  const s = await classSubject({ contentContract: options.contentContract ?? false });
  const j = await pointerOf(s.runId);
  const responder = await claimClass(s, j, options.db ? { db: options.db } : {});
  let moved: Observed | undefined;
  let target: string | null = null;
  let checkpoint: unknown;
  s.gate.hook = async () => {
    options.onCall?.(s.runId);
    target = to === "another" ? await anotherClassJob(s) : null;
    // Injected state: the pointer leaves the responder while its own attempt is in flight.
    await injectPointer(s.runId, target);
    if (options.ownerCheckpoint)
      checkpoint = await injectOwnerCheckpoint(s.runId, inFlightAttempt(await observe(s.runId)));
    moved = await observe(s.runId);
  };
  if (options.failWith) s.gate.failWith = options.failWith;
  await responder.run();
  if (!moved) throw new Error("Expected the responder's call");
  return {
    s,
    j,
    responder,
    moved: moved as Observed,
    target: target as string | null,
    checkpoint,
  };
}
/**
 * The responder's own attempt is accounted once (its state `state`, its hold closed, one row at
 * the real amount); nothing else of the run, its jobs or its checkpoints changed; and the responder
 * stood aside once, at its response.
 */
async function expectAccountedOnly(
  r: Awaited<ReturnType<typeof classResponseAway>>,
  state: "succeeded" | "failed",
  errorCode: string | null = null,
) {
  const { s, j, responder, moved, target } = r;
  const attempt = inFlightAttempt(moved);
  const after = await observe(s.runId);
  expect(after.attempts).toEqual([{ ...attempt, state, closedAt: expect.any(Date), errorCode }]);
  expect(after.costs).toEqual([{ attemptId: attempt.id, amount: CALL_MICROS, estimated: null }]);
  expect(after.pointer).toBe(target);
  expect(runFacts(after)).toEqual(runFacts(moved));
  expect(after.state).toBe("processing");
  expect(after.lastError).toBeNull();
  if (target) expect(after.job(target)).toEqual(moved.job(target));
  expect(s.gate.calls).toBe(1);
  expect(responder.standAsides()).toEqual([
    expect.objectContaining({ job_id: j, code: "not_owner", reason: "response" }),
  ]);
  return { attempt, after };
}

it.each([
  [
    "response guard proc.process: the responder started the attempt, then the pointer moved to another job; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "another",
  ],
  [
    "response guard proc.process: the responder started the attempt, then the pointer became null; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    const r = await classResponseAway(to);
    const { s, j, responder } = r;
    const { attempt, after } = await expectAccountedOnly(r, "succeeded");
    expect(attempt.step).toBe("knowledge");
    // No checkpoint of the response and no effect of its callback (the lesson's input context).
    expect(after.steps).not.toContain("knowledge");
    expect(after.steps).not.toContain("knowledge:input-context");
    expect(await stepOutput(s.runId, "knowledge")).toBeUndefined();
    // The handler wrote nothing after the stand-aside; its valid claim ends as a success.
    expect(await completeJob(db, responder.claim, new Date())).toBe(true);
    expect((await observe(s.runId)).job(j)?.state).toBe("succeeded");
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: handler redelivery stops at the start guard and writes no second cost row and nothing to the run",
  async () => {
    const r = await classResponseAway("another");
    const { s, j, responder } = r;
    const { after: first } = await expectAccountedOnly(r, "succeeded");
    // The same job's handler runs again under the same valid claim (a redelivery): the lesson is
    // not bought or recorded again, and the run is left as it was.
    await responder.run();
    const again = await observe(s.runId);
    expect(again.costs).toEqual(first.costs);
    expect(again.attempts).toEqual(first.attempts);
    expect(runFacts(again)).toEqual(runFacts(first));
    expect(s.gate.calls).toBe(1);
    expect(responder.standAsides()).toEqual([
      expect.objectContaining({ job_id: j, code: "not_owner", reason: "response" }),
      expect.objectContaining({ job_id: j, code: "not_owner", reason: "live_run" }),
    ]);
    expect(await completeJob(db, responder.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: the valid owner still writes its result and checkpoint",
  async () => {
    const s = await classSubject();
    const j = await pointerOf(s.runId);
    const owner = await claimClass(s, j);
    let during: Observed | undefined;
    s.gate.hook = async () => {
      during = await observe(s.runId);
    };
    await owner.run();
    expect(await completeJob(db, owner.claim, new Date())).toBe(true);
    if (!during) throw new Error("Expected the owner's call");
    const attempt = inFlightAttempt(during);
    await expectNormalSettle(s.runId, attempt.id);
    const after = await observe(s.runId);
    expect(owner.standAsides()).toEqual([]);
    expect(after.lastError).toBeNull();
    expect(after.costs).toHaveLength(1);
    // Its checkpoint holds the lesson it bought, and its callback saved the lesson's context.
    expect(JSON.stringify(await stepOutput(s.runId, "knowledge"))).toContain("Synthetic class");
    expect(after.steps).toContain("knowledge:input-context");
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: an invalid lease is still refused as today",
  async () => {
    const s = await classSubject();
    const j = await pointerOf(s.runId);
    const owner = await claimClass(s, j, { renew: false });
    let during: Observed | undefined;
    s.gate.hook = async () => {
      during = await observe(s.runId);
      await loseLease(owner.claim);
    };
    await owner.run();
    if (!during) throw new Error("Expected the owner's call");
    // Nothing of the response commits: no settle, no cost row, the attempt started, its hold open.
    const after = await observe(s.runId);
    expect(after.attempts).toEqual(during.attempts);
    expect(after.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    expect(after.costs).toEqual([]);
    expect(after.pointer).toBe(j);
    expect(after.steps).toEqual(during.steps);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(owner.logs.map((line) => line.event)).toContain(NOT_COMMITTED);
    expect(owner.standAsides()).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: a knowledge:truncated failure of a non-owner accounts once and writes no knowledge checkpoint",
  async () => {
    const r = await classResponseAway("another", {
      failWith: knownFailure("provider_output_truncated"),
    });
    const { attempt, after } = await expectAccountedOnly(r, "failed", "provider_output_truncated");
    expect(attempt.step).toBe("knowledge");
    expect(after.steps).not.toContain("knowledge:truncated");
    expect(await stepOutput(r.s.runId, "knowledge:truncated")).toBeUndefined();
    expect(await completeJob(db, r.responder.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: a knowledge:schema-invalid failure of a non-owner accounts once and writes no knowledge checkpoint",
  async () => {
    const r = await classResponseAway("another", {
      contentContract: true,
      failWith: knownFailure("provider_schema_invalid"),
    });
    const { attempt, after } = await expectAccountedOnly(r, "failed", "provider_schema_invalid");
    expect(attempt.step).toBe("knowledge");
    expect(after.steps).not.toContain("knowledge:schema-invalid");
    expect(await stepOutput(r.s.runId, "knowledge:schema-invalid")).toBeUndefined();
    expect(await completeJob(db, r.responder.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The two auxiliary kinds, through the real PLT runner (as in aux-continuation-owner.int.test.ts).

type AuxPayload = { runId: string; userId: string; subjectId: string };
interface AuxSubject {
  kind: string;
  runId: string;
  userId: string;
  gate: Gate;
  target: { userId: string; subjectId: string };
  definition: JobDefinition<AuxPayload>;
  /**
   * What the caller writes after a response (capture: the source's content versions and the
   * chunks' object states; voice: the analysis' saved mistakes).
   */
  effects: () => Promise<unknown>;
}
const CHUNK_MS = 2000;

/** A verified staged part of a class still recording, with its background transcription run. */
async function captureSubject(): Promise<AuxSubject> {
  const x = await studyFixture(db);
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await allowanceFor(x.ctx.userId, { audio: 60, regeneration: 1 });
  await costPolicy();
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/webm",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Session recording 2026-11-24 · Part 1",
    durationMs: 2 * CHUNK_MS,
    parts: [],
    operationKey: `recorded-source:${randomUUID()}`,
  });
  const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
  await renewCaptureLease(db, x.ctx, x.session.id);
  const staged = await beginStagedAudioUpload(db, x.ctx, source.assetId, { parts });
  const link = await temporaryAudioPartLink(
    db,
    store,
    x.ctx,
    source.assetId,
    staged.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "audio/webm")).toBe(200);
  await confirmTemporaryAudioPart(db, store, x.ctx, source.assetId, staged.uploadId, 0);
  await verifyTemporaryAudio(db, store, x.ctx, source.assetId, staged.uploadId, {
    inspect: async () => ({ durationMs: 2 * CHUNK_MS, audioOnly: true }),
  });
  // As the deployed preparer: each object record only with the job's authority (P11-02 AC-19).
  const prepareAudio: AudioPreparer = async ({ runId, source: selected, ctx, now, job }) =>
    Promise.all(
      [0, 1].map(async (index) => ({
        id: `${runId}-${index}`,
        sourceId: selected.sourceId,
        objectId: await writeOwnedObject(db, store, ctx, {
          module: "src",
          retention: "temporary",
          contentType: "audio/mpeg",
          bytes: new Uint8Array([0x49, 0x44, 0x33, index]),
          now,
          ...(job ? { job } : {}),
        }),
        offsetMs: index * CHUNK_MS,
        durationMs: CHUNK_MS,
        format: "mp3" as const,
      })),
    );
  const gate: Gate = { calls: 0 };
  const dependencies = {
    provider: gatedProvider(syntheticSettings("synthetic-owner"), gate),
    store,
    prepareAudio,
  };
  const runId = await scheduleCaptureTranscription(db, x.ctx, source.assetId, dependencies);
  if (!runId) throw new Error("Expected a capture transcription run");
  runIds.push(runId);
  const effects = async () => {
    const versions = await db
      .selectFrom("src.content_version")
      .select("id")
      .where("asset_id", "=", source.assetId)
      .execute();
    const plans = await db
      .selectFrom("proc.run_step")
      .select("output")
      .where("run_id", "=", runId)
      .where("step", "like", "audio:%")
      .execute();
    const objectIds = plans.flatMap((row) =>
      (row.output as unknown as { objectId: string }[]).map((chunk) => chunk.objectId),
    );
    const objects = await Promise.all(
      objectIds.map(
        async (id) => (await ownedObjectMetadata(db, x.ctx, id).catch(() => null))?.state ?? null,
      ),
    );
    return { versions: versions.length, objects };
  };
  return {
    kind: "proc.capture_transcription",
    runId,
    userId: x.ctx.userId,
    gate,
    target: { userId: x.ctx.userId, subjectId: source.assetId },
    definition: captureTranscriptionJob(dependencies),
    effects,
  };
}

/**
 * The acoustic check's engine (AC-32, AC-36): each call counts as started, waits for the test's
 * own step (`hold`, taken once) and counts as finished, then returns the two voices of the
 * fixture's recording; without `acoustic`, the original is unavailable and the check reads the
 * transcript labels instead, as before.
 */
interface Acoustic {
  started: number;
  finished: number;
  hold?: () => Promise<void>;
}
const VOICE_MODEL = "synthetic-owner-voice";
const voiceAxis = (index: number) => Array.from({ length: 16 }, (_, k) => (k === index ? 1 : 0));
/** The teacher's turn and the learner's two turns of twoSpeakerTranscript, each fully covered. */
function twoSpeakerDiarization(): VoiceDiarization {
  const segment = (speakerId: string, startMs: number, endMs: number) => ({
    speakerId,
    startMs,
    endMs,
    overlap: false,
    boundaryUnsafe: false,
  });
  return {
    modelRevision: VOICE_MODEL,
    segments: [segment("t", 500, 15500), segment("l", 21000, 30000), segment("l", 43000, 52000)],
    speakers: [
      { speakerId: "t", cleanSpeechMs: 30000, embedding: voiceAxis(0) },
      { speakerId: "l", cleanSpeechMs: 24000, embedding: voiceAxis(1) },
    ],
  };
}
function acousticEngine(acoustic: Acoustic | undefined) {
  return async (): Promise<VoiceDiarization> => {
    if (!acoustic) throw new Error("original_audio_unavailable");
    acoustic.started++;
    const hold = acoustic.hold;
    acoustic.hold = undefined;
    try {
      await hold?.();
    } finally {
      acoustic.finished++;
    }
    return twoSpeakerDiarization();
  };
}
/** A live temporary original of the recording (D29), so a check reads "audio" (AC-32, AC-36). */
async function liveOriginal(ctx: { userId: string; requestId: string }, assetId: string) {
  const objectId = await writeOwnedObject(db, new MemoryObjectStore(), ctx, {
    module: "src",
    retention: "temporary",
    contentType: "audio/mpeg",
    bytes: new Uint8Array([0x49, 0x44, 0x33]),
    now: new Date(),
  });
  await db
    .insertInto("src.audio_upload")
    .values({
      user_id: ctx.userId,
      asset_id: assetId,
      reservation_id: randomUUID(),
      object_id: objectId,
      state: "verified",
      actual_duration_ms: 60000,
      expires_at: new Date(Date.now() + 3600_000),
    })
    .execute();
}
/**
 * A class audio source of two speakers: the teacher once, the learner's same line twice. With
 * `repeated` false (AC-39), the learner's second turn is a self-correction, which corroborates
 * nothing: the analysis keeps its candidates but has no repeated evidence (the free branch).
 */
async function twoSpeakerSource(
  ctx: { userId: string; requestId: string },
  sessionId: string,
  repeated = true,
) {
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "audio",
      declared_mime: "audio/mpeg",
      verified_mime: "audio/mpeg",
      duration_ms: 60000,
      size_bytes: 1000,
      sha256: "a".repeat(64),
      display_name: "Synthetic two speakers",
      contract_version: "1",
      retention: "device_only",
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
      role: "class_audio",
      selected: true,
    })
    .execute();
  const speaker = (label: string) => scopedVoiceSpeakerId(asset.id, "fixture", label);
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, ctx, asset.id, {
      schemaVersion: "1",
      provenance: "machine_extraction",
      originKey: `voice-fixture:${asset.id}`,
      settings: { ranges: [] },
      units: [
        { id: "teacher", kind: "time", start: 1000, end: 15000, status: "extracted" },
        { id: "learner", kind: "time", start: 22000, end: 29000, status: "extracted" },
        { id: "learner-repeat", kind: "time", start: 44000, end: 51000, status: "extracted" },
      ],
      blocks: [
        {
          id: "teacher-text",
          kind: "transcript",
          unitId: "teacher",
          text: "Today we will review natural spoken English.",
          speakerId: speaker("teacher"),
        },
        {
          id: "learner-text",
          kind: "transcript",
          unitId: "learner",
          text: "I am agree with you.",
          speakerId: speaker("learner"),
        },
        {
          id: "learner-repeat-text",
          kind: "transcript",
          unitId: "learner-repeat",
          text: repeated ? "I am agree with you." : "Sorry, I mean I agree with you.",
          speakerId: speaker("learner"),
        },
      ],
    }),
  );
  return asset.id;
}
/** Every voice analysis of the class, as a write or a relink could change it. */
async function voiceRows(sessionId: string) {
  return db
    .selectFrom("voc.analysis")
    .select([
      "id",
      "run_id",
      "status",
      "reason",
      "candidate_id",
      "mistakes",
      "speaker_links",
      "model_version",
      "updated_at",
    ])
    .where("session_id", "=", sessionId)
    .orderBy("id")
    .execute();
}
/** Waits, reading only, until `ready` holds. */
async function until(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let tries = 0; tries < 300; tries++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${what}`);
}

/** A class audio source with speaker-labelled transcript turns and its explicit voice check run. */
async function voiceSubject(acoustic?: Acoustic, repeated = true): Promise<AuxSubject> {
  const x = await studyFixture(db);
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const assetId = await twoSpeakerSource(x.ctx, x.session.id, repeated);
  // With `acoustic`, a live original and the acoustic engine (AC-36); otherwise the source keeps
  // no original here, so the check reads the transcript labels instead.
  if (acoustic) await liveOriginal(x.ctx, assetId);
  await allowanceFor(x.ctx.userId, { audio: 2000, document: 100, regeneration: 10 });
  await costPolicy();
  const diarize = acousticEngine(acoustic);
  const gate: Gate = { calls: 0 };
  const dependencies = {
    provider: gatedProvider(syntheticSettings("synthetic-owner"), gate),
    diarize,
  };
  const runId = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey: randomUUID(),
  });
  runIds.push(runId);
  const effects = async () =>
    (
      await db
        .selectFrom("voc.analysis")
        .select(["id", "mistakes"])
        .where("run_id", "=", runId)
        .orderBy("id")
        .execute()
    ).map((row) => ({ id: row.id, mistakes: row.mistakes }));
  return {
    kind: "proc.voice_analysis",
    runId,
    userId: x.ctx.userId,
    gate,
    target: { userId: x.ctx.userId, subjectId: x.session.id },
    definition: voiceAnalysisJob(dependencies),
    effects,
  };
}

interface Round {
  /** The injected clock of the round (milliseconds); it decides which job is due. */
  at: number;
  /** Time for a provider call; otherwise the capture job hands the run on at once. */
  time?: boolean;
  /** After the handler, its lease runs out unrenewed: the runner's completeJob then refuses. */
  loseLease?: boolean;
  /** The handler runs twice under the same claim, a redelivery, before the runner completes it. */
  repeat?: boolean;
  /** The database the runner and its handler use (the AC-33 replay seam); the same one otherwise. */
  db?: Database;
}
/** One round of the real PLT runner over this subject's jobs only (its target), one job at most. */
async function round(s: AuxSubject, r: Round) {
  let clock = r.at;
  const ran: string[] = [];
  const logs: Logged[] = [];
  const wrapped: JobDefinition<AuxPayload> = {
    ...s.definition,
    async run(payload, job) {
      ran.push(job.job.id);
      try {
        await s.definition.run(payload, job);
        if (r.repeat) await s.definition.run(payload, job);
        if (r.loseLease) await leaseEnded(job.job.id);
      } finally {
        // Past the round's deadline: the runner claims nothing more.
        clock = r.at + 24 * 60 * MINUTE;
      }
    },
  };
  await runDueJobs(r.db ?? db, [wrapped], {
    now: () => new Date(clock),
    deadline: new Date(r.at + MINUTE),
    finishBy: new Date(r.at + (r.time ? 30 * MINUTE : 1000)),
    kinds: [s.definition.kind],
    target: s.target,
    leaseRenewalMs: r.loseLease ? 3_600_000 : 250,
    log: (_level, event, fields) => logs.push({ ...fields, event }),
  });
  return { ran, logs, standAsides: logs.filter((line) => line.event === AUX_NOT_OWNER) };
}

const auxMakers = {
  "proc.capture_transcription": captureSubject,
  "proc.voice_analysis": () => voiceSubject(),
} as const;
type AuxKind = keyof typeof auxMakers;

/**
 * J hands the run on to J2 as its owner (capture: no time for a call; voice: its analysis saved)
 * and its authority ends before its completeJob, so the sweep returns it. J2, claimed first, then
 * holds its paid call; inside that call J's retry, really claimed by the runner, reaches its
 * provider step, and with `reconcile` the existing reconciliation runs too. The answer then
 * arrives.
 */
async function auxInFlight(kind: AuxKind, reconcile: boolean) {
  const s = await auxMakers[kind]();
  const base = Date.now();
  const first = await round(s, { at: base + 10 * MINUTE, loseLease: true });
  const [j] = first.ran;
  expect(first.standAsides).toEqual([]);
  const j2 = await pointerOf(s.runId);
  expect(j2).not.toBe(j);
  let during:
    | {
        attempts: Observed["attempts"];
        ran: string[];
        stood: Logged[];
        job: string | undefined;
        effects: unknown;
      }
    | undefined;
  let attemptId = "";
  s.gate.hook = async () => {
    const open = await observe(s.runId);
    const retry = await round(s, { at: base + 20 * MINUTE, time: true });
    const now = await observe(s.runId);
    during = {
      attempts: now.attempts,
      ran: retry.ran,
      stood: retry.standAsides,
      job: now.job(j)?.state,
      effects: await s.effects(),
    };
    expect(now.attempts).toEqual(open.attempts);
    expect(now.pointer).toBe(j2);
    if (reconcile) attemptId = await reconcileKeepsLiveHold(s.runId, s.userId);
  };
  // J2's run_at is earlier than J's, so this round claims J2.
  const second = await round(s, { at: base + 20 * MINUTE, time: true });
  expect(second.ran).toEqual([j2]);
  expect(second.standAsides).toEqual([]);
  return { s, j, j2, during, attemptId };
}

it.each([
  [
    "attempt guard proc.capture_transcription: a non-owner starts no provider attempt and closes no live hold",
    "proc.capture_transcription",
  ],
  [
    "attempt guard proc.voice_analysis: a non-owner starts no provider attempt and closes no live hold",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    const { s, j, j2, during } = await auxInFlight(kind, false);
    // While J2's call was in flight: one attempt, J2's, its hold open; J started none.
    expect(during?.ran).toEqual([j]);
    expect(during?.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    // A valid non-owner ends as a success with nothing done, and says so once.
    expect(during?.job).toBe("succeeded");
    expect(during?.stood).toEqual([
      expect.objectContaining({ kind: s.kind, job_id: j, code: "not_owner", reason: "fail" }),
    ]);
    const after = await observe(s.runId);
    expect(after.lastError).toBeNull();
    expect(after.attempts.every((row) => row.state === "succeeded")).toBe(true);
    expect(after.costs).toHaveLength(after.attempts.length);
    // Only J2 and its own continuations called the provider.
    expect(s.gate.calls).toBe(after.attempts.length);
    expect(after.job(j2)?.state).toBe("succeeded");
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "in-flight proc.capture_transcription: provider waits, reconcile runs, the response arrives: one accounting and no wrong close",
    "proc.capture_transcription",
  ],
  [
    "in-flight proc.voice_analysis: provider waits, reconcile runs, the response arrives: one accounting and no wrong close",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    const { s, j, during, attemptId } = await auxInFlight(kind, true);
    expect(during?.ran).toEqual([j]);
    expect(during?.stood).toHaveLength(1);
    expect(attemptId).not.toBe("");
    const attempt = await expectNormalSettle(s.runId, attemptId);
    const after = await observe(s.runId);
    expect(after.lastError).toBeNull();
    expect(after.costs).toHaveLength(after.attempts.length);
    // The owner's checkpoint holds what it bought, and its own effect after the response is there.
    const output = JSON.stringify(await stepOutput(s.runId, attempt.step));
    expect(output).toContain(kind === "proc.capture_transcription" ? "Synthetic speech." : "true");
    expect(await s.effects()).not.toEqual(during?.effects);
    // The reconciliation run again after the response writes no second row.
    await expectNoSecondRow(s.runId, s.userId, attemptId);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The response guard of the two auxiliary kinds (AC-27, AC-30), through the real PLT runner.

/** The run's owner before its paid call (voice: the check saves its analysis and hands on first). */
async function auxOwner(kind: AuxKind) {
  const s = await auxMakers[kind]();
  const base = Date.now();
  if (kind === "proc.voice_analysis") {
    const first = await round(s, { at: base + 10 * MINUTE });
    expect(first.standAsides).toEqual([]);
  }
  return { s, base, owner: await pointerOf(s.runId) };
}
/** Another job of the same run (an injected owner), due much later, so no runner here takes it. */
async function anotherAuxJob(s: AuxSubject): Promise<string> {
  const id = await db.transaction().execute((tx) =>
    enqueueJob(tx, s.definition, {
      payload: { runId: s.runId, ...s.target },
      singletonKey: `${s.runId}:another-writer`,
      now: new Date(),
      runAt: new Date(Date.now() + 48 * 60 * MINUTE),
      defaults: DEFAULT_PLT_SETTINGS.jobs,
    }),
  );
  if (!id) throw new Error("Expected the other writer's job");
  return id;
}
/** The owner, really claimed by the runner, starts its attempt; the pointer then moves away. */
async function auxResponseAway(
  kind: AuxKind,
  to: "another" | "null",
  repeat = false,
  options: { db?: Database; ownerCheckpoint?: boolean; onCall?: (runId: string) => void } = {},
) {
  const { s, base, owner } = await auxOwner(kind);
  let moved: { observed: Observed; effects: unknown } | undefined;
  let target: string | null = null;
  let checkpoint: unknown;
  s.gate.hook = async () => {
    options.onCall?.(s.runId);
    target = to === "another" ? await anotherAuxJob(s) : null;
    // Injected state: the pointer leaves the responder while its own attempt is in flight.
    await injectPointer(s.runId, target);
    if (options.ownerCheckpoint)
      checkpoint = await injectOwnerCheckpoint(s.runId, inFlightAttempt(await observe(s.runId)));
    moved = { observed: await observe(s.runId), effects: await s.effects() };
  };
  const paid = await round(s, {
    at: base + 20 * MINUTE,
    time: true,
    repeat,
    ...(options.db ? { db: options.db } : {}),
  });
  expect(paid.ran).toEqual([owner]);
  if (!moved) throw new Error("Expected the responder's call");
  const { observed, effects } = moved as { observed: Observed; effects: unknown };
  const attempt = inFlightAttempt(observed);
  const after = await observe(s.runId);
  // Its own attempt accounted once: resolved, its hold closed, one row at the real amount.
  expect(after.attempts).toEqual(
    observed.attempts.map((row) =>
      row.id === attempt.id ? { ...row, state: "succeeded", closedAt: expect.any(Date) } : row,
    ),
  );
  expect(after.costs.filter((row) => row.attemptId === attempt.id)).toEqual([
    { attemptId: attempt.id, amount: CALL_MICROS, estimated: null },
  ]);
  expect(after.costs).toHaveLength(observed.costs.length + 1);
  // No run result, checkpoint, callback or caller effect; the new owner's data as it was.
  expect(after.pointer).toBe(target);
  expect(runFacts(after)).toEqual({
    ...runFacts(observed),
    jobs: runFacts(observed).jobs.map((row) =>
      row.id === owner ? { ...row, state: "succeeded" } : row,
    ),
  });
  if (options.ownerCheckpoint) {
    // The new owner's distinct checkpoint content, exactly as it was (AC-33).
    expect(checkpoint).toBeDefined();
    expect(await stepOutput(s.runId, attempt.step)).toEqual(checkpoint);
  } else {
    expect(after.steps).not.toContain(attempt.step);
    expect(await stepOutput(s.runId, attempt.step)).toBeUndefined();
  }
  expect(after.state).toBe("processing");
  expect(after.lastError).toBeNull();
  const t = target as string | null;
  if (t) expect(after.job(t)).toEqual(observed.job(t));
  expect(await s.effects()).toEqual(effects);
  expect(s.gate.calls).toBe(1);
  return { s, owner, paid, after, attempt };
}

it.each([
  [
    "response guard proc.capture_transcription: the responder started the attempt, then the pointer moved to another job; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "proc.capture_transcription",
    "another",
  ],
  [
    "response guard proc.capture_transcription: the responder started the attempt, then the pointer became null; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "proc.capture_transcription",
    "null",
  ],
  [
    "response guard proc.voice_analysis: the responder started the attempt, then the pointer moved to another job; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "proc.voice_analysis",
    "another",
  ],
  [
    "response guard proc.voice_analysis: the responder started the attempt, then the pointer became null; with a valid lease it accounts once and writes no run result, checkpoint or callback",
    "proc.voice_analysis",
    "null",
  ],
] as [string, AuxKind, "another" | "null"][])(
  "%s",
  async (_name, kind, to) => {
    const { s, owner, paid } = await auxResponseAway(kind, to);
    // A valid non-owner ends as a success with nothing more done, and says so once.
    expect(paid.standAsides).toEqual([
      expect.objectContaining({ kind: s.kind, job_id: owner, code: "not_owner", reason: "fail" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "response guard proc.capture_transcription: handler redelivery stops at the start guard and writes no second cost row and nothing to the run",
    "proc.capture_transcription",
  ],
  [
    "response guard proc.voice_analysis: handler redelivery stops at the start guard and writes no second cost row and nothing to the run",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    // The handler runs twice under the same valid claim (a redelivery): the second run buys and
    // records nothing again; auxResponseAway's checks hold after both.
    const { s, owner, paid } = await auxResponseAway(kind, "another", true);
    expect(paid.standAsides).toEqual([
      expect.objectContaining({ kind: s.kind, job_id: owner, code: "not_owner", reason: "fail" }),
      expect.objectContaining({ kind: s.kind, job_id: owner, code: "not_owner", reason: "fail" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "response guard proc.capture_transcription: the valid owner still writes its result and checkpoint",
    "proc.capture_transcription",
  ],
  [
    "response guard proc.voice_analysis: the valid owner still writes its result and checkpoint",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    const { s, base, owner } = await auxOwner(kind);
    let during: { observed: Observed; effects: unknown } | undefined;
    s.gate.hook = async () => {
      during = { observed: await observe(s.runId), effects: await s.effects() };
    };
    const paid = await round(s, { at: base + 20 * MINUTE, time: true });
    expect(paid.ran).toEqual([owner]);
    expect(paid.standAsides).toEqual([]);
    if (!during) throw new Error("Expected the owner's call");
    const { observed, effects } = during as { observed: Observed; effects: unknown };
    const attempt = inFlightAttempt(observed);
    await expectNormalSettle(s.runId, attempt.id);
    const after = await observe(s.runId);
    expect(after.lastError).toBeNull();
    expect(after.attempts.every((row) => row.state === "succeeded")).toBe(true);
    expect(after.costs).toHaveLength(after.attempts.length);
    // Its checkpoint holds what it bought, and its own effect after the response is there.
    expect(after.steps).toContain(attempt.step);
    const output = JSON.stringify(await stepOutput(s.runId, attempt.step));
    expect(output).toContain(kind === "proc.capture_transcription" ? "Synthetic speech." : "true");
    expect(await s.effects()).not.toEqual(effects);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "response guard proc.capture_transcription: an invalid lease is still refused as today",
    "proc.capture_transcription",
  ],
  [
    "response guard proc.voice_analysis: an invalid lease is still refused as today",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    const { s, base, owner } = await auxOwner(kind);
    let during: Observed | undefined;
    s.gate.hook = async () => {
      during = await observe(s.runId);
      await loseLease({ id: owner });
    };
    const paid = await round(s, { at: base + 20 * MINUTE, time: true, loseLease: true });
    expect(paid.ran).toEqual([owner]);
    if (!during) throw new Error("Expected the owner's call");
    const observed = during as Observed;
    const attempt = inFlightAttempt(observed);
    // Nothing of the response commits: no settle, no cost row, the attempt started, its hold open.
    const after = await observe(s.runId);
    expect(after.attempts).toEqual(observed.attempts);
    expect(after.attempts.find((row) => row.id === attempt.id)).toMatchObject({
      state: "started",
      closedAt: null,
    });
    expect(after.costs).toEqual(observed.costs);
    expect(after.pointer).toBe(owner);
    expect(after.steps).toEqual(observed.steps);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(paid.logs.map((line) => line.event)).toContain(NOT_COMMITTED);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The response replay (AC-33, R2-P1201-A-03): the same attempt, operation key and response
// consumed a second time at the commit boundary, and the new owner's own checkpoint content.

/** The accounting of a run's attempts as a commit could write it: attempts, holds and cost rows. */
async function accounting(runId: string) {
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["id", "state", "error_code", "provider_request_id", "finished_at"])
    .where("run_id", "=", runId)
    .orderBy("started_at")
    .execute();
  const holds = await db
    .selectFrom("proc.provider_attempt as a")
    .innerJoin("quota.cost_hold as h", "h.id", "a.hold_id")
    .select(["h.id as id", "h.closed_at as closedAt"])
    .where("a.run_id", "=", runId)
    .orderBy("h.id")
    .execute();
  const costs = await db
    .selectFrom("quota.provider_cost")
    .selectAll()
    .where("run_id", "=", runId)
    .orderBy("operation_key")
    .execute();
  return { attempts, holds, costs };
}
interface Replay {
  /** Armed inside the responder's call; the first commit boundary that stands aside disarms it. */
  armed: boolean;
  runId?: string;
  /** The outcomes of the two consumptions of the same closure, in order. */
  consumed: unknown[];
  /** The run's accounting between the first consumption and the second. */
  between?: Awaited<ReturnType<typeof accounting>>;
}
/**
 * The AC-33 seam, on the test side only (no production API is added for it): the job's own
 * database, except that once armed, the first transaction whose outcome is a responder's
 * stand-aside at the commit boundary of its response (`{ notOwned }`) is run once more, in a
 * transaction of its own, with the very same closure: the same attempt, operation key, provider
 * response and job. Both outcomes are kept, so a test shows the second one reached that boundary.
 */
function replayingDatabase(base: Database) {
  const replay: Replay = { armed: false, consumed: [] };
  const bound = (target: object, name: string | symbol) => {
    const value = Reflect.get(target, name, target);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const standsAside = (outcome: unknown) =>
    typeof outcome === "object" && outcome !== null && "notOwned" in outcome;
  const proxied = new Proxy(base, {
    get(target, name) {
      if (name !== "transaction") return bound(target, name);
      return () => {
        const builder = target.transaction();
        return new Proxy(builder, {
          get(inner, member) {
            if (member !== "execute") return bound(inner, member);
            return async <T>(effect: (tx: Tx) => Promise<T>): Promise<T> => {
              const first = await inner.execute(effect);
              if (replay.armed && standsAside(first)) {
                replay.armed = false;
                if (replay.runId) replay.between = await accounting(replay.runId);
                const second = await target.transaction().execute(effect);
                replay.consumed.push(first, second);
              }
              return first;
            };
          },
        });
      };
    },
  });
  const arm = (runId: string) => {
    replay.runId = runId;
    replay.armed = true;
  };
  return { db: proxied as Database, replay, arm };
}
/**
 * The replay's positive control and its checks: the boundary was reached twice (two outcomes, the
 * second the same stand-aside as the first, after its accounting check), and the second wrote no
 * second cost row and no second accounting: the attempt, its hold and the cost rows as after the
 * first.
 */
async function expectReplayedOnce(replay: Replay, runId: string) {
  expect(replay.armed).toBe(false);
  expect(replay.consumed).toHaveLength(2);
  expect(replay.consumed[0]).toEqual({ notOwned: expect.any(String) });
  expect(replay.consumed[1]).toEqual(replay.consumed[0]);
  const after = await accounting(runId);
  expect(replay.between).toBeDefined();
  expect(after).toEqual(replay.between);
  expect(after.costs).toHaveLength(1);
}

it(
  "response replay proc.process: the same attempt and response consumed twice at the commit boundary write no second cost row, no second accounting and no effective callback, result or checkpoint, and the boundary is shown to be reached",
  async () => {
    const seam = replayingDatabase(db);
    const r = await classResponseAway("another", {
      db: seam.db,
      ownerCheckpoint: true,
      onCall: seam.arm,
    });
    // Once accounted, one stand-aside line, nothing else of the run changed (expectAccountedOnly).
    const { after } = await expectAccountedOnly(r, "succeeded");
    await expectReplayedOnce(seam.replay, r.s.runId);
    // No callback effect (the lesson's input context) and the new owner's checkpoint as it was.
    expect(after.steps).not.toContain("knowledge:input-context");
    expect(r.checkpoint).toBeDefined();
    expect(await stepOutput(r.s.runId, "knowledge")).toEqual(r.checkpoint);
    expect(await completeJob(db, r.responder.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "response replay proc.capture_transcription: the same attempt and response consumed twice at the commit boundary write no second cost row, no second accounting and no effective callback, result or checkpoint, and the boundary is shown to be reached",
    "proc.capture_transcription",
  ],
  [
    "response replay proc.voice_analysis: the same attempt and response consumed twice at the commit boundary write no second cost row, no second accounting and no effective callback, result or checkpoint, and the boundary is shown to be reached",
    "proc.voice_analysis",
  ],
] as [string, AuxKind][])(
  "%s",
  async (_name, kind) => {
    const seam = replayingDatabase(db);
    // auxResponseAway checks the one accounting, the caller's effects as they were, the run and
    // the new owner's job as they were, and the new owner's distinct checkpoint content.
    const { s, owner, paid, after, attempt } = await auxResponseAway(kind, "another", false, {
      db: seam.db,
      ownerCheckpoint: true,
      onCall: seam.arm,
    });
    // The accounting check of auxResponseAway covers only this attempt's row; the voice run
    // also holds the rows of its earlier rounds, so the replay is judged on this attempt.
    expect(seam.replay.consumed).toHaveLength(2);
    expect(seam.replay.consumed[0]).toEqual({ notOwned: "auxiliary" });
    expect(seam.replay.consumed[1]).toEqual(seam.replay.consumed[0]);
    const now = await accounting(s.runId);
    expect(now).toEqual(seam.replay.between);
    expect(now.costs.filter((row) => row.attempt_id === attempt.id)).toHaveLength(1);
    expect(after.costs.filter((row) => row.attemptId === attempt.id)).toHaveLength(1);
    expect(paid.standAsides).toEqual([
      expect.objectContaining({ kind: s.kind, job_id: owner, code: "not_owner", reason: "fail" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "response guard proc.process: the distinct existing checkpoint content of the new owner stays unchanged after a non-owner response",
  async () => {
    const r = await classResponseAway("another", { ownerCheckpoint: true });
    const { after } = await expectAccountedOnly(r, "succeeded");
    expect(r.checkpoint).toBeDefined();
    expect(await stepOutput(r.s.runId, "knowledge")).toEqual(r.checkpoint);
    expect(after.steps).not.toContain("knowledge:input-context");
    expect(await completeJob(db, r.responder.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The voice writes of a class run (AC-31, AC-32, AC-35): a class over one recording of two
// speakers, its job really claimed as above.

/**
 * A class run over one recording of two speakers, with its acoustic check (AC-31, AC-32).
 * Extraction is cached as the voice fixtures cache it (the run's own `source:` checkpoints); with
 * `lessonCached`, the lesson too, so the run goes on to the spoken-mistake correction.
 */
async function classVoiceSubject(options: {
  acoustic?: Acoustic;
  lessonCached?: boolean;
  repeated?: boolean;
}) {
  const x = await studyFixture(db);
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const assetId = await twoSpeakerSource(x.ctx, x.session.id, options.repeated ?? true);
  await liveOriginal(x.ctx, assetId);
  await allowanceFor(x.ctx.userId, { audio: 2000, document: 100, regeneration: 100 });
  await costPolicy();
  const gate: Gate = { calls: 0 };
  const provider = gatedProvider(syntheticSettings("synthetic-owner"), gate);
  const job = processingJob({
    provider,
    store: new MemoryObjectStore(),
    diarizeVoice: acousticEngine(options.acoustic),
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  for (const source of snapshot.sources) {
    if (source.kind === "audio") expect(source.objectId).toBeTruthy();
    await db
      .insertInto("proc.run_step")
      .values({
        run_id: run.id,
        step: `source:${source.sourceId}`,
        output: JSON.stringify(source),
        completed_at: new Date(),
      })
      .execute();
  }
  if (options.lessonCached)
    await db
      .insertInto("proc.run_step")
      .values({
        run_id: run.id,
        step: "knowledge",
        output: JSON.stringify({
          ...syntheticKnowledge(1),
          sourceClassifications: snapshot.sources.map((source) => ({
            sourceId: source.sourceId,
            classification: { role: "class_material", confidence: "high" },
          })),
        }),
        completed_at: new Date(),
      })
      .execute();
  return { ctx: x.ctx, sessionId: x.session.id, runId: run.id, gate, job };
}

/**
 * J, the owner, saves the class's analysis (from the transcript labels) and hands the run on to
 * J2, which then reaches the paid correction of that analysis (AC-31).
 */
async function correctionOwner() {
  const s = await classVoiceSubject({ lessonCached: true });
  const first = await pointerOf(s.runId);
  const j = await claimClass(s, first);
  await j.run();
  expect(await completeJob(db, j.claim, new Date())).toBe(true);
  expect(j.standAsides()).toEqual([]);
  const second = await pointerOf(s.runId);
  expect(second).not.toBe(first);
  const saved = await voiceRows(s.sessionId);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.run_id).toBe(s.runId);
  expect(s.gate.calls).toBe(0);
  return { s, second, saved };
}

it.each([
  [
    "voice correction proc.process: the owner started the class response, then the pointer moved to another job; with a valid lease it accounts once and leaves voc.analysis, callback, checkpoint, run and the new owner's data unchanged",
    "another",
  ],
  [
    "voice correction proc.process: the owner started the class response, then the pointer became null; with a valid lease it accounts once and leaves voc.analysis, callback, checkpoint, run and the new owner's data unchanged",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    const { s, second, saved } = await correctionOwner();
    const j2 = await claimClass(s, second);
    let moved: Observed | undefined;
    let target: string | null = null;
    s.gate.hook = async () => {
      target = to === "another" ? await anotherClassJob(s) : null;
      // Injected state: the pointer leaves J2 while its own correction call is in flight.
      await injectPointer(s.runId, target);
      moved = await observe(s.runId);
    };
    await j2.run();
    if (!moved) throw new Error("Expected J2's correction call");
    const observed = moved as Observed;
    const attempt = inFlightAttempt(observed);
    const after = await observe(s.runId);
    // The correction's own attempt is accounted once.
    expect(after.attempts).toEqual([
      { ...attempt, state: "succeeded", closedAt: expect.any(Date), errorCode: null },
    ]);
    expect(after.costs).toEqual([{ attemptId: attempt.id, amount: CALL_MICROS, estimated: null }]);
    // No voc.analysis change (no saved mistakes from the callback, no failure mark, no relink),
    // no checkpoint, the run and the new owner's job as they were.
    expect(await voiceRows(s.sessionId)).toEqual(saved);
    expect(runFacts(after)).toEqual(runFacts(observed));
    expect(after.pointer).toBe(target);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    const t = target as string | null;
    if (t) expect(after.job(t)).toEqual(observed.job(t));
    expect(s.gate.calls).toBe(1);
    // One stand-aside line, at the response; no retry or failure of its own.
    expect(j2.standAsides()).toEqual([
      expect.objectContaining({ job_id: second, code: "not_owner", reason: "response" }),
    ]);
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
    expect((await observe(s.runId)).job(second)?.state).toBe("succeeded");
  },
  TEST_TIMEOUT_MS,
);

it(
  "voice correction proc.process: a lost lease leaves voc.analysis unchanged and writes no refused cost",
  async () => {
    const { s, second, saved } = await correctionOwner();
    const j2 = await claimClass(s, second, { renew: false });
    let during: Observed | undefined;
    s.gate.hook = async () => {
      during = await observe(s.runId);
      await loseLease(j2.claim);
    };
    await j2.run();
    if (!during) throw new Error("Expected J2's correction call");
    const observed = during as Observed;
    const after = await observe(s.runId);
    // The refused commit wrote nothing: the attempt started, its hold open, no cost row.
    expect(after.attempts).toEqual(observed.attempts);
    expect(after.attempts.map((row) => ({ state: row.state, closedAt: row.closedAt }))).toEqual([
      { state: "started", closedAt: null },
    ]);
    expect(after.costs).toEqual([]);
    // No failure mark or other voc.analysis write after the refusal.
    expect(await voiceRows(s.sessionId)).toEqual(saved);
    expect(after.pointer).toBe(second);
    expect(after.steps).toEqual(observed.steps);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(j2.logs.map((line) => line.event)).toContain(NOT_COMMITTED);
    expect(j2.standAsides()).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "voice correction proc.voice_analysis: a lost lease leaves voc.analysis unchanged and writes no refused cost",
  async () => {
    const { s, base, owner } = await auxOwner("proc.voice_analysis");
    const saved = await voiceRows(s.target.subjectId);
    expect(saved).toHaveLength(1);
    let during: Observed | undefined;
    s.gate.hook = async () => {
      during = await observe(s.runId);
      await loseLease({ id: owner });
    };
    const paid = await round(s, { at: base + 20 * MINUTE, time: true, loseLease: true });
    expect(paid.ran).toEqual([owner]);
    if (!during) throw new Error("Expected the correction call");
    const observed = during as Observed;
    const attempt = inFlightAttempt(observed);
    const after = await observe(s.runId);
    expect(after.attempts).toEqual(observed.attempts);
    expect(after.attempts.find((row) => row.id === attempt.id)).toMatchObject({
      state: "started",
      closedAt: null,
    });
    expect(after.costs).toEqual(observed.costs);
    expect(await voiceRows(s.target.subjectId)).toEqual(saved);
    expect(after.pointer).toBe(owner);
    expect(after.steps).toEqual(observed.steps);
    expect(after.lastError).toBeNull();
    expect(paid.logs.map((line) => line.event)).toContain(NOT_COMMITTED);
    // No not-owner line: the claim was void, not the ownership.
    expect(paid.standAsides.filter((line) => line.code === "not_owner")).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "voice correction proc.process: the valid owner still corrects as today",
  async () => {
    const { s, second, saved } = await correctionOwner();
    const j2 = await claimClass(s, second);
    await j2.run();
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
    expect(j2.standAsides()).toEqual([]);
    const after = await observe(s.runId);
    expect(s.gate.calls).toBe(1);
    expect(after.attempts.map((row) => row.state)).toEqual(["succeeded"]);
    expect(after.costs).toHaveLength(1);
    // Its callback saved the learner's mistake on the same analysis, and the run goes on.
    const corrected = await voiceRows(s.sessionId);
    expect(corrected.map((row) => row.id)).toEqual(saved.map((row) => row.id));
    expect(corrected[0]?.mistakes).not.toEqual(saved[0]?.mistakes);
    expect(JSON.stringify(corrected[0]?.mistakes)).toContain("I agree with you.");
    expect(after.lastError).toBeNull();
    expect(after.pointer).not.toBe(second);
  },
  TEST_TIMEOUT_MS,
);

it(
  "voice correction proc.process: a real error of the valid owner keeps today's contract",
  async () => {
    const { s, second, saved } = await correctionOwner();
    const j2 = await claimClass(s, second);
    s.gate.failWith = knownFailure("provider_schema_invalid");
    await j2.run();
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
    expect(j2.standAsides()).toEqual([]);
    const after = await observe(s.runId);
    // The known paid failure is accounted once, and the owner marks its analysis as before.
    expect(after.attempts.map((row) => ({ state: row.state, errorCode: row.errorCode }))).toEqual([
      { state: "failed", errorCode: "provider_schema_invalid" },
    ]);
    expect(after.costs).toHaveLength(1);
    const marked = await voiceRows(s.sessionId);
    expect(marked.map((row) => row.id)).toEqual(saved.map((row) => row.id));
    expect(saved[0]?.reason ?? "").not.toMatch(/^voice_correction_/);
    expect(marked[0]?.reason).toMatch(/^voice_correction_/);
    expect(marked[0]?.mistakes).toEqual(saved[0]?.mistakes);
    expect(after.lastError).toBeNull();
    expect(after.state).toBe("processing");
  },
  TEST_TIMEOUT_MS,
);

/**
 * The class job, the run's owner, with its acoustic check and its lesson call both held (AC-32).
 * With `to`, the pointer then leaves it; with `invalidLease`, its lease runs out. The lesson's
 * answer is released first; the acoustic check only after the lesson's response stood aside (or
 * was refused, or, for the owner, committed). Every part the check started is counted.
 */
async function acousticLane(options: { to?: "another" | "null"; invalidLease?: boolean } = {}) {
  let releaseAcoustic = () => {};
  let releaseLesson = () => {};
  let lessonWaiting = false;
  const acoustic: Acoustic = {
    started: 0,
    finished: 0,
    hold: () =>
      new Promise<void>((resolve) => {
        releaseAcoustic = resolve;
      }),
  };
  const s = await classVoiceSubject({ acoustic });
  const j = await pointerOf(s.runId);
  const before = await voiceRows(s.sessionId);
  const owner = await claimClass(s, j, options.invalidLease ? { renew: false } : {});
  s.gate.hook = () =>
    new Promise<void>((resolve) => {
      lessonWaiting = true;
      releaseLesson = resolve;
    });
  const running = owner.run();
  await until(
    () => acoustic.started === 1 && lessonWaiting,
    "the acoustic check and the lesson call both waiting",
  );
  let target: string | null = j;
  if (options.to) {
    target = options.to === "another" ? await anotherClassJob(s) : null;
    // Injected state: the pointer leaves the job while both its acoustic check and its call wait.
    await injectPointer(s.runId, target);
  }
  if (options.invalidLease) await loseLease(owner.claim);
  const moved = await observe(s.runId);
  releaseLesson();
  if (options.to)
    await until(() => owner.standAsides().length > 0, "the lesson response's stand-aside");
  else if (options.invalidLease)
    await until(
      () => owner.logs.some((line) => line.event === NOT_COMMITTED),
      "the refused lesson response",
    );
  else
    await until(
      async () => (await observe(s.runId)).attempts.some((row) => row.state === "succeeded"),
      "the owner's lesson commit",
    );
  expect(acoustic.finished).toBe(0);
  releaseAcoustic();
  await running;
  return { s, j, owner, acoustic, before, moved, target };
}

it.each([
  [
    "acoustic lane proc.process: the pointer moves to another job while the acoustic check and the lesson provider wait; after the lesson response stands aside, the released acoustic check writes no voc.analysis, relink, checkpoint or result, the lesson accounting stays and no started work is left running",
    "another",
  ],
  [
    "acoustic lane proc.process: the pointer becomes null while the acoustic check and the lesson provider wait; after the lesson response stands aside, the released acoustic check writes no voc.analysis, relink, checkpoint or result, the lesson accounting stays and no started work is left running",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    const r = await acousticLane({ to });
    const after = await observe(r.s.runId);
    // The lesson's own attempt keeps its accounting: resolved once, one row at the real amount.
    const attempt = inFlightAttempt(r.moved);
    expect(attempt.step).toBe("knowledge");
    expect(after.attempts).toEqual([
      { ...attempt, state: "succeeded", closedAt: expect.any(Date), errorCode: null },
    ]);
    expect(after.costs).toEqual([{ attemptId: attempt.id, amount: CALL_MICROS, estimated: null }]);
    // The released check wrote no analysis and relinked nothing; no checkpoint or result either.
    expect(await voiceRows(r.s.sessionId)).toEqual(r.before);
    expect(runFacts(after)).toEqual(runFacts(r.moved));
    expect(after.pointer).toBe(r.target);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    if (r.target) expect(after.job(r.target)).toEqual(r.moved.job(r.target));
    // Every part the check started is done, and the handler's stop says so once.
    expect(r.acoustic).toMatchObject({ started: 1, finished: 1 });
    expect(r.owner.standAsides()).toEqual([
      expect.objectContaining({ job_id: r.j, code: "not_owner", reason: "response" }),
    ]);
    expect(await completeJob(db, r.owner.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

it(
  "acoustic lane proc.process: with an invalid lease the released acoustic check writes no voc.analysis and no relink",
  async () => {
    const r = await acousticLane({ invalidLease: true });
    const after = await observe(r.s.runId);
    expect(await voiceRows(r.s.sessionId)).toEqual(r.before);
    // The refused lesson commit wrote nothing either: its attempt started, its hold open.
    expect(after.attempts).toEqual(r.moved.attempts);
    expect(after.costs).toEqual([]);
    expect(after.pointer).toBe(r.j);
    expect(after.steps).toEqual(r.moved.steps);
    expect(after.state).toBe("processing");
    expect(after.lastError).toBeNull();
    expect(r.acoustic).toMatchObject({ started: 1, finished: 1 });
    expect(r.owner.standAsides()).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "acoustic lane proc.process: the valid owner still saves the acoustic analysis and relinks as today",
  async () => {
    const r = await acousticLane();
    await completeJob(db, r.owner.claim, new Date());
    expect(r.owner.standAsides()).toEqual([]);
    expect(r.acoustic).toMatchObject({ started: 1, finished: 1 });
    const rows = await voiceRows(r.s.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run_id: r.s.runId, model_version: VOICE_MODEL });
    // Relinked as the class's voices: its voices carry their class voice links.
    expect(Object.keys((rows[0]?.speaker_links ?? {}) as object).length).toBeGreaterThan(0);
    // The lesson's own call was accounted as the owner's.
    const after = await observe(r.s.runId);
    expect(after.attempts[0]).toMatchObject({ step: "knowledge", state: "succeeded" });
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The voice check job's two writing calls (AC-36): voice-jobs.ts analyzeVoiceSources (the check of
// every part) and processVoiceSource (the correction of a saved analysis), through the real PLT
// runner, with the acoustic engine and a live original.

/** :426-type path: the pointer leaves the job while the acoustic check of a part runs. */
async function voiceJobAwayAtCheck(to: "another" | "null") {
  const acoustic: Acoustic = { started: 0, finished: 0 };
  const s = await voiceSubject(acoustic);
  const sessionId = s.target.subjectId;
  const owner = await pointerOf(s.runId);
  let target: string | null = null;
  let moved: Observed | undefined;
  acoustic.hold = async () => {
    target = to === "another" ? await anotherAuxJob(s) : null;
    // Injected state: the pointer leaves the job while its check of a part runs.
    await injectPointer(s.runId, target);
    moved = await observe(s.runId);
  };
  const before = await voiceRows(sessionId);
  const first = await round(s, { at: Date.now() + 10 * MINUTE, time: true });
  expect(first.ran).toEqual([owner]);
  if (!moved) throw new Error("Expected the check of a part");
  const observed = moved as Observed;
  expect(acoustic).toMatchObject({ started: 1, finished: 1 });
  const after = await observe(s.runId);
  expect(await voiceRows(sessionId)).toEqual(before);
  expect(after.pointer).toBe(target);
  expect(runFacts(after)).toEqual({
    ...runFacts(observed),
    jobs: runFacts(observed).jobs.map((row) =>
      row.id === owner ? { ...row, state: "succeeded" } : row,
    ),
  });
  expect(after.attempts).toEqual([]);
  // The run is still in its first stage (queued, its initial state) when the check stops; the
  // stop writes no state of its own: the state after is the snapshot's (AC-36, verdict 002 §5).
  expect(observed.state).toBe("queued");
  expect(after.state).toBe(observed.state);
  expect(after.lastError).toBeNull();
  const t = target as string | null;
  if (t) expect(after.job(t)).toEqual(observed.job(t));
  // The refused acoustic write before the continuation: one pointer_moved/continue line (AC-43).
  expect(first.standAsides).toEqual([
    expect.objectContaining({
      kind: s.kind,
      job_id: owner,
      code: "pointer_moved",
      reason: "continue",
    }),
  ]);
}
/** :440-type path: the owner saved the analysis; the pointer leaves its correction's job. */
async function voiceJobAwayAtCorrection(to: "another" | "null") {
  const s = await voiceSubject({ started: 0, finished: 0 });
  const sessionId = s.target.subjectId;
  const base = Date.now();
  const first = await round(s, { at: base + 10 * MINUTE, time: true });
  expect(first.standAsides).toEqual([]);
  const owner = await pointerOf(s.runId);
  const saved = await voiceRows(sessionId);
  expect(saved).toHaveLength(1);
  let target: string | null = null;
  let moved: Observed | undefined;
  s.gate.hook = async () => {
    target = to === "another" ? await anotherAuxJob(s) : null;
    // Injected state: the pointer leaves the job while its correction call is in flight.
    await injectPointer(s.runId, target);
    moved = await observe(s.runId);
  };
  const paid = await round(s, { at: base + 20 * MINUTE, time: true });
  expect(paid.ran).toEqual([owner]);
  if (!moved) throw new Error("Expected the correction call");
  const observed = moved as Observed;
  const attempt = inFlightAttempt(observed);
  const after = await observe(s.runId);
  expect(after.costs.filter((row) => row.attemptId === attempt.id)).toEqual([
    { attemptId: attempt.id, amount: CALL_MICROS, estimated: null },
  ]);
  // No saved mistakes, no failure mark, no relink.
  expect(await voiceRows(sessionId)).toEqual(saved);
  expect(after.pointer).toBe(target);
  expect(runFacts(after)).toEqual({
    ...runFacts(observed),
    jobs: runFacts(observed).jobs.map((row) =>
      row.id === owner ? { ...row, state: "succeeded" } : row,
    ),
  });
  // The state of this stage's own snapshot, as it was (AC-36; not forced to queued).
  expect(after.state).toBe(observed.state);
  expect(after.lastError).toBeNull();
  expect(paid.standAsides).toEqual([
    expect.objectContaining({ kind: s.kind, job_id: owner, code: "not_owner", reason: "fail" }),
  ]);
}

it(
  "voice analysis job proc.voice_analysis: with a real claim the valid owner still saves the voice analysis and relinks as today",
  async () => {
    const acoustic: Acoustic = { started: 0, finished: 0 };
    const s = await voiceSubject(acoustic);
    const sessionId = s.target.subjectId;
    const base = Date.now();
    const owner = await pointerOf(s.runId);
    // The check of every part (voice-jobs.ts analyzeVoiceSources) saves and relinks as the owner.
    const first = await round(s, { at: base + 10 * MINUTE, time: true });
    expect(first.ran).toEqual([owner]);
    expect(first.standAsides).toEqual([]);
    expect(acoustic).toMatchObject({ started: 1, finished: 1 });
    const saved = await voiceRows(sessionId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ run_id: s.runId, model_version: VOICE_MODEL });
    expect(Object.keys((saved[0]?.speaker_links ?? {}) as object).length).toBeGreaterThan(0);
    const second = await pointerOf(s.runId);
    expect(second).not.toBe(owner);
    // The correction of the saved analysis (voice-jobs.ts processVoiceSource), as the owner.
    const paid = await round(s, { at: base + 20 * MINUTE, time: true });
    expect(paid.ran).toEqual([second]);
    expect(paid.standAsides).toEqual([]);
    expect(s.gate.calls).toBe(1);
    const corrected = await voiceRows(sessionId);
    expect(corrected.map((row) => row.id)).toEqual(saved.map((row) => row.id));
    expect(JSON.stringify(corrected[0]?.mistakes)).toContain("I agree with you.");
    const after = await observe(s.runId);
    expect(after.attempts.map((row) => row.state)).toEqual(["succeeded"]);
    expect(after.costs).toHaveLength(1);
    expect(after.lastError).toBeNull();
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "voice analysis job proc.voice_analysis: after the pointer moves to another job a real claim writes no voc.analysis and no relink",
    "another",
  ],
  [
    "voice analysis job proc.voice_analysis: after the pointer becomes null a real claim writes no voc.analysis and no relink",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    // Both writing calls of the job, each on a run of its own; each runs to its end, so a failure
    // of the first does not hide the second's evidence (AC-36, verdict 002 §5).
    const failures: unknown[] = [];
    for (const away of [voiceJobAwayAtCheck, voiceJobAwayAtCorrection]) {
      try {
        await away(to);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Both voice job paths failed");
  },
  2 * TEST_TIMEOUT_MS,
);

it(
  "voice analysis job proc.voice_analysis: an invalid lease writes no voc.analysis and no relink",
  async () => {
    const acoustic: Acoustic = { started: 0, finished: 0 };
    const s = await voiceSubject(acoustic);
    const sessionId = s.target.subjectId;
    const owner = await pointerOf(s.runId);
    // The job's lease runs out while its check of a part runs; the snapshot just before that.
    let stopped: Observed | undefined;
    acoustic.hold = async () => {
      stopped = await observe(s.runId);
      await loseLease({ id: owner });
    };
    const before = await voiceRows(sessionId);
    const observedBefore = await observe(s.runId);
    const first = await round(s, { at: Date.now() + 10 * MINUTE, time: true, loseLease: true });
    expect(first.ran).toEqual([owner]);
    if (!stopped) throw new Error("Expected the check of a part");
    const snapshot = stopped as Observed;
    expect(acoustic).toMatchObject({ started: 1, finished: 1 });
    expect(await voiceRows(sessionId)).toEqual(before);
    const after = await observe(s.runId);
    expect(after.pointer).toBe(owner);
    expect(after.steps).toEqual(observedBefore.steps);
    expect(after.attempts).toEqual([]);
    // Queued, its initial state, when the check stops; the state after is that snapshot's (AC-36).
    expect(snapshot.state).toBe("queued");
    expect(after.state).toBe(snapshot.state);
    expect(after.lastError).toBeNull();
    expect(first.standAsides.filter((line) => line.code === "not_owner")).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "voice write boundary: an input without Job authority, or with neither a lease nor the existing marker, is refused before any voc.analysis write",
  async () => {
    const s = await voiceSubject({ started: 0, finished: 0 });
    const sessionId = s.target.subjectId;
    const ctx = { userId: s.userId, requestId: randomUUID() };
    const pointer = await pointerOf(s.runId);
    const row = await db
      .selectFrom("proc.processing_run")
      .select("input_snapshot")
      .where("id", "=", s.runId)
      .executeTakeFirstOrThrow();
    const sources = sourceSnapshotSchema
      .parse((row.input_snapshot as { request: unknown }).request)
      .sources.filter((source) => source.kind === "audio")
      .map((source) => ({ ...source, objectId: source.objectId ?? randomUUID() }));
    const source = sources[0];
    if (!source) throw new Error("Expected the recording");
    // The engine counts each preparation, so the refusal is shown to come at the write itself.
    const engine: Acoustic = { started: 0, finished: 0 };
    const diarize = acousticEngine(engine);
    // A context made by hand: the run's job id, but no lease and no marker.
    const handMade = {
      db,
      now: () => new Date(),
      job: { id: pointer, attempt: 1 },
    } as unknown as JobContext;
    const common = { db, ctx, sessionId, runId: s.runId, diarize, now: () => new Date() };
    await expect(
      processVoiceSource({
        ...common,
        job: undefined as unknown as JobContext,
        source,
        correct: async () => false,
      }),
    ).rejects.toMatchObject({ name: "JobLeaseLost" });
    await expect(
      processVoiceSource({ ...common, job: handMade, source, correct: async () => false }),
    ).rejects.toMatchObject({ name: "JobLeaseLost" });
    await expect(
      analyzeVoiceSources({
        ...common,
        job: handMade,
        sources,
        concurrency: 1,
        canStart: () => true,
      }),
    ).rejects.toMatchObject({ name: "JobLeaseLost" });
    expect(engine).toMatchObject({ started: 3, finished: 3 });
    expect(await voiceRows(sessionId)).toEqual([]);
    expect(await pointerOf(s.runId)).toBe(pointer);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The free voice correction (AC-39, AC-42; R2-P1201-D-01): a saved analysis with candidates but no
// repeated evidence records "no mistakes" for free, with no provider call. That write is made only
// as the run's owner, in the transaction of its write boundary, on both job paths (the class job's
// correction stage and the voice check job).

/**
 * The AC-39 seam, on the test side only (no production API is added for it): the job's own
 * database, except that a transaction opened by the free correction write (writeAsRunOwner called
 * from correctVoiceCandidates, read from the call stack when the transaction is opened) first runs
 * `before`, once. `reached` counts those transactions: the positive control that the free branch
 * itself was taken, not an earlier stop.
 */
function freeWriteDatabase(base: Database, before?: () => Promise<void>) {
  const seam = { reached: 0 };
  let pending = before;
  const bound = (target: object, name: string | symbol) => {
    const value = Reflect.get(target, name, target);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const proxied = new Proxy(base, {
    get(target, name) {
      if (name !== "transaction") return bound(target, name);
      return () => {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 64;
        const stack = new Error().stack ?? "";
        Error.stackTraceLimit = limit;
        const builder = target.transaction();
        if (!stack.includes("writeAsRunOwner") || !stack.includes("correctVoiceCandidates"))
          return builder;
        seam.reached++;
        return new Proxy(builder, {
          get(inner, member) {
            if (member !== "execute") return bound(inner, member);
            return async <T>(effect: (tx: Tx) => Promise<T>): Promise<T> => {
              const hook = pending;
              pending = undefined;
              await hook?.();
              return inner.execute(effect);
            };
          },
        });
      };
    },
  });
  return { db: proxied as Database, seam };
}
/** The run's one saved analysis, as the correction reads it. */
async function savedAnalysis(
  ctx: { userId: string; requestId: string },
  sessionId: string,
  runId: string,
): Promise<PrivateVoiceAnalysis> {
  const row = await db
    .selectFrom("voc.analysis")
    .select(["source_id", "source_version_id"])
    .where("run_id", "=", runId)
    .executeTakeFirstOrThrow();
  const analysis = await findVoiceAnalysis(db, ctx, {
    sessionId,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    runId,
  });
  if (!analysis) throw new Error("Expected the saved analysis");
  return analysis;
}
/** The free branch's precondition: candidates, no repeated evidence, mistakes not yet recorded. */
function expectFreeBranch(analysis: PrivateVoiceAnalysis) {
  expect(analysis.candidates.length).toBeGreaterThan(0);
  expect(hasRepeatableVoiceEvidence(analysis.utterances)).toBe(false);
  expect(
    analysis.candidates.every((candidate) => Object.hasOwn(analysis.mistakes, candidate.id)),
  ).toBe(false);
}
/** The owner's free write: "no mistakes" for every candidate of the same analysis. */
function expectFreeSave(before: PrivateVoiceAnalysis, after: PrivateVoiceAnalysis) {
  expect(after.id).toBe(before.id);
  expect(Object.keys(after.mistakes).sort()).toEqual(
    before.candidates.map((candidate) => candidate.id).sort(),
  );
  for (const items of Object.values(after.mistakes)) expect(items).toEqual([]);
}

/** J, the class run's owner, saves an analysis with no repeated evidence and hands on to J2. */
async function freeClassOwner() {
  const s = await classVoiceSubject({ lessonCached: true, repeated: false });
  const first = await pointerOf(s.runId);
  const j = await claimClass(s, first);
  await j.run();
  expect(await completeJob(db, j.claim, new Date())).toBe(true);
  expect(j.standAsides()).toEqual([]);
  const second = await pointerOf(s.runId);
  expect(second).not.toBe(first);
  const saved = await voiceRows(s.sessionId);
  expect(saved).toHaveLength(1);
  const analysis = await savedAnalysis(s.ctx, s.sessionId, s.runId);
  expectFreeBranch(analysis);
  expect(s.gate.calls).toBe(0);
  return { s, second, saved, analysis };
}
/** J2 reaches the free write; `away` runs just before that write's transaction opens. */
async function freeClassAway(options: { to?: "another" | "null"; invalidLease?: boolean }) {
  const { s, second, saved, analysis } = await freeClassOwner();
  let target: string | null = second;
  let moved: Observed | undefined;
  const { db: seamDb, seam } = freeWriteDatabase(db, async () => {
    if (options.to) {
      target = options.to === "another" ? await anotherClassJob(s) : null;
      // Injected state: the pointer leaves J2 after its start guard, before its free write.
      await injectPointer(s.runId, target);
    }
    if (options.invalidLease) await loseLease({ id: second });
    moved = await observe(s.runId);
  });
  const j2 = await claimClass(s, second, {
    db: seamDb,
    ...(options.invalidLease ? { renew: false } : {}),
  });
  await j2.run();
  // The positive control: J2 really reached the free branch's write, once.
  expect(seam.reached).toBe(1);
  if (!moved) throw new Error("Expected the free write");
  const observed = moved as Observed;
  const after = await observe(s.runId);
  // The whole voc.analysis row as it was; no callback, checkpoint or run change; no paid call.
  expect(await voiceRows(s.sessionId)).toEqual(saved);
  expect(runFacts(after)).toEqual(runFacts(observed));
  expect(after.attempts).toEqual([]);
  expect(after.costs).toEqual([]);
  expect(s.gate.calls).toBe(0);
  expect(after.pointer).toBe(target);
  expect(after.lastError).toBeNull();
  const t = target as string | null;
  if (t && t !== second) expect(after.job(t)).toEqual(observed.job(t));
  return { s, second, j2, analysis, after, observed };
}

it.each([
  [
    "free voice correction proc.process: after the pointer moves to another job the free path changes nothing",
    "another",
  ],
  [
    "free voice correction proc.process: after the pointer becomes null the free path changes nothing",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    const { second, j2 } = await freeClassAway({ to });
    // One stand-aside line, at the refused write (the class contract); no retry or failure.
    expect(j2.standAsides()).toEqual([
      expect.objectContaining({ job_id: second, code: "not_owner", reason: "write" }),
    ]);
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

it(
  "free voice correction proc.process: an invalid lease makes the free path change nothing",
  async () => {
    const { second, j2, after } = await freeClassAway({ invalidLease: true });
    expect(after.pointer).toBe(second);
    // The claim was void, not the ownership: no not-owner line.
    expect(j2.standAsides()).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "free voice correction proc.process: the valid owner still saves the free correction as today",
  async () => {
    const { s, second, saved, analysis } = await freeClassOwner();
    const { db: seamDb, seam } = freeWriteDatabase(db);
    const j2 = await claimClass(s, second, { db: seamDb });
    await j2.run();
    expect(await completeJob(db, j2.claim, new Date())).toBe(true);
    expect(seam.reached).toBe(1);
    expect(j2.standAsides()).toEqual([]);
    // Saved for free on the same analysis: no provider call, no attempt and no cost row.
    expectFreeSave(analysis, await savedAnalysis(s.ctx, s.sessionId, s.runId));
    expect((await voiceRows(s.sessionId))[0]?.updated_at).not.toEqual(saved[0]?.updated_at);
    const after = await observe(s.runId);
    expect(s.gate.calls).toBe(0);
    expect(after.attempts).toEqual([]);
    expect(after.costs).toEqual([]);
    expect(after.lastError).toBeNull();
    // The run goes on as before: J2 hands on after its saved progress.
    expect(after.pointer).not.toBe(second);
  },
  TEST_TIMEOUT_MS,
);

/** J, the voice check job's owner, saves an analysis with no repeated evidence and hands on. */
async function freeVoiceOwner() {
  const s = await voiceSubject(undefined, false);
  const sessionId = s.target.subjectId;
  const ctx = { userId: s.userId, requestId: randomUUID() };
  const base = Date.now();
  const first = await round(s, { at: base + 10 * MINUTE });
  expect(first.standAsides).toEqual([]);
  const owner = await pointerOf(s.runId);
  const saved = await voiceRows(sessionId);
  expect(saved).toHaveLength(1);
  const analysis = await savedAnalysis(ctx, sessionId, s.runId);
  expectFreeBranch(analysis);
  expect(s.gate.calls).toBe(0);
  return { s, sessionId, ctx, base, owner, saved, analysis };
}
/** The owner's next job reaches the free write; `away` runs just before its transaction opens. */
async function freeVoiceAway(options: { to?: "another" | "null"; invalidLease?: boolean }) {
  const { s, sessionId, base, owner, saved } = await freeVoiceOwner();
  let target: string | null = owner;
  let moved: Observed | undefined;
  const { db: seamDb, seam } = freeWriteDatabase(db, async () => {
    if (options.to) {
      target = options.to === "another" ? await anotherAuxJob(s) : null;
      // Injected state: the pointer leaves the job before its free write.
      await injectPointer(s.runId, target);
    }
    if (options.invalidLease) await loseLease({ id: owner });
    moved = await observe(s.runId);
  });
  const paid = await round(s, {
    at: base + 20 * MINUTE,
    time: true,
    db: seamDb,
    ...(options.invalidLease ? { loseLease: true } : {}),
  });
  expect(paid.ran).toEqual([owner]);
  expect(seam.reached).toBe(1);
  if (!moved) throw new Error("Expected the free write");
  const observed = moved as Observed;
  const after = await observe(s.runId);
  expect(await voiceRows(sessionId)).toEqual(saved);
  expect(after.attempts).toEqual([]);
  expect(after.costs).toEqual([]);
  expect(s.gate.calls).toBe(0);
  expect(after.pointer).toBe(target);
  expect(after.steps).toEqual(observed.steps);
  expect(after.state).toBe(observed.state);
  expect(after.lastError).toBeNull();
  const t = target as string | null;
  if (t && t !== owner) expect(after.job(t)).toEqual(observed.job(t));
  return { s, owner, paid, after, observed };
}

it.each([
  [
    "free voice correction proc.voice_analysis: after the pointer moves to another job the free path changes nothing",
    "another",
  ],
  [
    "free voice correction proc.voice_analysis: after the pointer becomes null the free path changes nothing",
    "null",
  ],
] as [string, "another" | "null"][])(
  "%s",
  async (_name, to) => {
    const { s, owner, paid, after, observed } = await freeVoiceAway({ to });
    expect(runFacts(after)).toEqual({
      ...runFacts(observed),
      jobs: runFacts(observed).jobs.map((row) =>
        row.id === owner ? { ...row, state: "succeeded" } : row,
      ),
    });
    // A refused voice write before the continuation: one pointer_moved/continue line (AC-43).
    expect(paid.standAsides).toEqual([
      expect.objectContaining({
        kind: s.kind,
        job_id: owner,
        code: "pointer_moved",
        reason: "continue",
      }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "free voice correction proc.voice_analysis: an invalid lease makes the free path change nothing",
  async () => {
    const { s, owner, paid, after } = await freeVoiceAway({ invalidLease: true });
    expect(after.pointer).toBe(owner);
    // The lease's own stand-aside, once; never a pointer_moved one (AC-43).
    expect(paid.standAsides).toEqual([
      expect.objectContaining({
        kind: s.kind,
        job_id: owner,
        code: "job_lease_lost",
        reason: "fail",
      }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it(
  "free voice correction proc.voice_analysis: the valid owner still saves the free correction as today",
  async () => {
    const { s, sessionId, ctx, base, owner, saved, analysis } = await freeVoiceOwner();
    const { db: seamDb, seam } = freeWriteDatabase(db);
    const paid = await round(s, { at: base + 20 * MINUTE, time: true, db: seamDb });
    expect(paid.ran).toEqual([owner]);
    expect(seam.reached).toBe(1);
    expect(paid.standAsides).toEqual([]);
    expectFreeSave(analysis, await savedAnalysis(ctx, sessionId, s.runId));
    expect((await voiceRows(sessionId))[0]?.updated_at).not.toEqual(saved[0]?.updated_at);
    const after = await observe(s.runId);
    expect(s.gate.calls).toBe(0);
    expect(after.attempts).toEqual([]);
    expect(after.costs).toEqual([]);
    expect(after.lastError).toBeNull();
    // Its saved progress hands the run on, as before.
    expect(after.pointer).not.toBe(owner);
  },
  TEST_TIMEOUT_MS,
);

it(
  "free voice correction: an input without Job authority is refused before the free write",
  async () => {
    // Deliberately without authority (AC-39): no Job, and a Job with neither a lease nor a mark,
    // both on a saved analysis that takes the free branch.
    const { s, sessionId, ctx, owner, saved, analysis } = await freeVoiceOwner();
    const { db: seamDb, seam } = freeWriteDatabase(db);
    const execute = vi.fn();
    const common = {
      db: seamDb,
      ctx,
      runId: s.runId,
      analysis,
      provider: gatedProvider(syntheticSettings("synthetic-owner"), s.gate),
      execute,
      now: () => new Date(),
    };
    const handMade = {
      db: seamDb,
      now: () => new Date(),
      job: { id: owner, attempt: 1 },
    } as unknown as JobContext;
    await expect(correctVoiceCandidates({ ...common })).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    await expect(correctVoiceCandidates({ ...common, job: handMade })).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    // Both reached the free branch's write and were refused there; nothing paid was dispatched.
    expect(seam.reached).toBe(2);
    expect(execute).not.toHaveBeenCalled();
    expect(s.gate.calls).toBe(0);
    expect(await voiceRows(sessionId)).toEqual(saved);
    expect(await pointerOf(s.runId)).toBe(owner);
  },
  TEST_TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------------
// The acoustic preparation catch (AC-40; R2-P1201-D-02): a stand-aside or cancellation from the
// engine is passed on before any fallback; an ordinary engine error keeps today's fallback.

/** The class job, the run's owner, with its acoustic engine started and held; it then rejects. */
async function acousticPreparation(reject: () => Error, options: { cancel?: boolean } = {}) {
  let rejectEngine: (error: Error) => void = () => {};
  const acoustic: Acoustic = {
    started: 0,
    finished: 0,
    hold: () =>
      new Promise<void>((_resolve, fail) => {
        rejectEngine = fail;
      }),
  };
  const s = await classVoiceSubject({ acoustic, lessonCached: true });
  const j = await pointerOf(s.runId);
  const before = await voiceRows(s.sessionId);
  const owner = await claimClass(s, j);
  const running = owner.run();
  await until(() => acoustic.started === 1, "the acoustic engine started");
  // A real cancellation of the job (its lease is void after it).
  if (options.cancel) await cancelJob(db, j, new Date());
  const held = await observe(s.runId);
  expect(acoustic.finished).toBe(0);
  rejectEngine(reject());
  await running;
  return { s, j, owner, acoustic, before, held };
}

it(
  "acoustic preparation: the engine really starts and waits, then the job is cancelled; the preparation catch passes the cancellation through with no fallback, save or relink, collects the started work and writes no extra log",
  async () => {
    // First with the lease and the pointer still valid when the engine rejects, so no guard
    // further down can be why nothing is written; then after a real cancellation of the job.
    for (const cancel of [false, true]) {
      const r = await acousticPreparation(() => new JobCancelled(), { cancel });
      if (!cancel) {
        expect(r.held.pointer).toBe(r.j);
        expect(r.held.job(r.j)).toMatchObject({
          state: "running",
          lease_token: r.owner.claim.token,
        });
      } else expect(r.held.job(r.j)?.state).toBe("cancelled");
      const after = await observe(r.s.runId);
      // No fallback analysis saved, nothing relinked, no checkpoint or result, no paid call.
      expect(await voiceRows(r.s.sessionId)).toEqual(r.before);
      expect(r.before).toEqual([]);
      expect(runFacts(after)).toEqual(runFacts(r.held));
      expect(after.attempts).toEqual([]);
      expect(after.costs).toEqual([]);
      expect(r.s.gate.calls).toBe(0);
      // The started engine run is collected, and the stop writes no line of its own.
      expect(r.acoustic).toMatchObject({ started: 1, finished: 1 });
      expect(r.owner.logs).toEqual([]);
      expect(await completeJob(db, r.owner.claim, new Date())).toBe(!cancel);
    }
  },
  2 * TEST_TIMEOUT_MS,
);

it(
  "acoustic preparation: a normal engine error of the valid owner still takes today's fallback",
  async () => {
    const r = await acousticPreparation(() => new Error("voice_engine_failed"));
    expect(await completeJob(db, r.owner.claim, new Date())).toBe(true);
    expect(r.acoustic).toMatchObject({ started: 1, finished: 1 });
    expect(r.owner.standAsides()).toEqual([]);
    // The transcript fallback is saved as the owner's analysis, and the run goes on.
    const rows = await voiceRows(r.s.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run_id: r.s.runId, model_version: "transcript-labels-v1" });
    const after = await observe(r.s.runId);
    expect(after.lastError).toBeNull();
    expect(after.pointer).not.toBe(r.j);
    expect(r.s.gate.calls).toBe(0);
  },
  TEST_TIMEOUT_MS,
);
