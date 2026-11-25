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
import { studyFixture } from "../../test/study-fixture";
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
import { createDatabase } from "../db";
import type { KnowledgeModel } from "../lkm";
import { createSession, renewCaptureLease } from "../org";
import {
  type ClaimedJob,
  cancelJob,
  claimJobs,
  completeJob,
  DEFAULT_PLT_SETTINGS,
  enqueueJob,
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
import { enableVoice, VOICE_CONSENT_VERSION } from "../voc";
import { captureTranscriptionJob, scheduleCaptureTranscription } from "./capture-transcription";
import { reconcileEndedJobRuns } from "./maintenance";
import { createProcessingRun } from "./runs";
import { scheduleVoiceReanalysis, voiceAnalysisJob } from "./voice-jobs";
import { scopedVoiceSpeakerId, type VoiceDiarization } from "./voice-processing";
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
  s: ClassSubject,
  jobId: string,
  options: { deadline?: Date; definition?: JobDefinition<ClassPayload>; renew?: boolean } = {},
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
    db,
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

/** Injected state: the run's pointer, as a writer the job layer can no longer produce sets it. */
async function injectPointer(runId: string, to: string | null) {
  await db.updateTable("proc.processing_run").set({ job_id: to }).where("id", "=", runId).execute();
}
/** Another job of the same run (an injected owner), due much later, so no runner here takes it. */
async function anotherClassJob(s: ClassSubject): Promise<string> {
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
  options: { contentContract?: boolean; failWith?: (model: string) => ProviderError } = {},
) {
  const s = await classSubject({ contentContract: options.contentContract ?? false });
  const j = await pointerOf(s.runId);
  const responder = await claimClass(s, j);
  let moved: Observed | undefined;
  let target: string | null = null;
  s.gate.hook = async () => {
    target = to === "another" ? await anotherClassJob(s) : null;
    // Injected state: the pointer leaves the responder while its own attempt is in flight.
    await injectPointer(s.runId, target);
    moved = await observe(s.runId);
  };
  if (options.failWith) s.gate.failWith = options.failWith;
  await responder.run();
  if (!moved) throw new Error("Expected the responder's call");
  return { s, j, responder, moved: moved as Observed, target: target as string | null };
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
  "response guard proc.process: a repeated response after losing ownership writes no second cost row and nothing to the run",
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

/** A class audio source with speaker-labelled transcript turns and its explicit voice check run. */
async function voiceSubject(): Promise<AuxSubject> {
  const x = await studyFixture(db);
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
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
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: asset.id,
      role: "class_audio",
      selected: true,
    })
    .execute();
  const speaker = (label: string) => scopedVoiceSpeakerId(asset.id, "fixture", label);
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, asset.id, {
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
          text: "I am agree with you.",
          speakerId: speaker("learner"),
        },
      ],
    }),
  );
  await allowanceFor(x.ctx.userId, { audio: 2000, document: 100, regeneration: 10 });
  await costPolicy();
  // The source keeps no original here, so the check reads the transcript labels instead.
  const diarize = async (): Promise<VoiceDiarization> => {
    throw new Error("original_audio_unavailable");
  };
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
  await runDueJobs(db, [wrapped], {
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
  "proc.voice_analysis": voiceSubject,
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
async function auxResponseAway(kind: AuxKind, to: "another" | "null", repeat = false) {
  const { s, base, owner } = await auxOwner(kind);
  let moved: { observed: Observed; effects: unknown } | undefined;
  let target: string | null = null;
  s.gate.hook = async () => {
    target = to === "another" ? await anotherAuxJob(s) : null;
    // Injected state: the pointer leaves the responder while its own attempt is in flight.
    await injectPointer(s.runId, target);
    moved = { observed: await observe(s.runId), effects: await s.effects() };
  };
  const paid = await round(s, { at: base + 20 * MINUTE, time: true, repeat });
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
  expect(after.steps).not.toContain(attempt.step);
  expect(await stepOutput(s.runId, attempt.step)).toBeUndefined();
  expect(after.state).toBe("processing");
  expect(after.lastError).toBeNull();
  const t = target as string | null;
  if (t) expect(after.job(t)).toEqual(observed.job(t));
  expect(await s.effects()).toEqual(effects);
  expect(s.gate.calls).toBe(1);
  return { s, owner, paid, after };
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
    "response guard proc.capture_transcription: a repeated response after losing ownership writes no second cost row and nothing to the run",
    "proc.capture_transcription",
  ],
  [
    "response guard proc.voice_analysis: a repeated response after losing ownership writes no second cost row and nothing to the run",
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
