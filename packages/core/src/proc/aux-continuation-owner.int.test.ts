// P12-06 (C11-77, auxiliary part; owner answers to E553 and E559): the two auxiliary continuation
// builders, proc.capture_transcription and proc.voice_analysis, write the run's pointer
// (proc.processing_run.job_id), end the run and fail it only as the job the pointer names, with a
// valid claim. Every job here is enqueued by the code under test, claimed, swept and completed by
// the real PLT runner (runDueJobs) with a real lease; no test-only mark and no direct write of a
// job's state. The injected clock only orders run_at (which job a round claims); a lease is lost
// by really running out on the database clock, without renewal. Only two scenarios set the pointer
// directly, as data the job layer cannot produce: a legacy null pointer (AC-10) and a pointer
// another writer moved (the zero-row case, AC-1). Money and attempt expectations for these kinds
// are P12-01's (AC-6), not this file's.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import type { AiProvider, ProviderResult, ProviderSettings, StructuredInput } from "../aip";
import { createDatabase } from "../db";
import { renewCaptureLease } from "../org";
import {
  type ClaimedJob,
  cancelJob,
  claimJobs,
  DEFAULT_PLT_SETTINGS,
  enqueueJob,
  type JobDefinition,
  type LogValue,
  MemoryObjectStore,
  runDueJobs,
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
import { scheduleVoiceReanalysis, voiceAnalysisJob } from "./voice-jobs";
import { scopedVoiceSpeakerId, type VoiceDiarization } from "./voice-processing";
import type { AudioPreparer } from "./worker";

/** Short leases, so a lease really runs out within a test; every job here is enqueued with it. */
const LEASE_SECONDS = 3;
vi.stubEnv("PLT_SETTINGS_JSON", JSON.stringify({ jobs: { leaseSeconds: LEASE_SECONDS } }));

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    // Only this file's runs: no job of theirs is left for another file's runner.
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
const TEST_TIMEOUT_MS = 90_000;
const NOT_OWNER = "auxiliary_run_not_owner";

type AuxPayload = { runId: string; userId: string; subjectId: string };
interface Subject {
  kind: string;
  runId: string;
  target: { userId: string; subjectId: string };
  definition: JobDefinition<AuxPayload>;
  /** The same kind and run with provider settings that no longer match the run's: a real error. */
  broken: JobDefinition<AuxPayload>;
}

function syntheticSettings(version: string): ProviderSettings {
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
  };
}

/** Answers the voice correction only; capture jobs here always continue before any call. */
function syntheticProvider(settings: ProviderSettings): AiProvider {
  return {
    name: "synthetic-aux-owner",
    mode: "mock",
    settings,
    async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
      if (input.schemaName !== "spoken_mistake_candidates")
        throw new Error("Only the voice correction may dispatch in this fixture");
      const data = JSON.parse(input.input);
      const learner = data.utterances.find((item: { text: string }) =>
        item.text.includes("am agree"),
      );
      const output = input.schema.parse({
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
      });
      return {
        output,
        requestId: "synthetic-aux-owner-correction",
        provider: "synthetic-aux-owner",
        model: input.model,
        actualMicros: 10,
        usage: { inputTokens: 20, outputTokens: 20 },
      };
    },
    async transcribe(): Promise<never> {
      throw new Error("No transcription in this fixture");
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
    reason: "Synthetic auxiliary owner integration",
  });
}

const CHUNK_MS = 2000;

/** A verified staged part of a class still recording, with its background transcription run. */
async function captureSubject(): Promise<Subject> {
  const x = await studyFixture(db);
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await allowanceFor(x.ctx.userId, { audio: 60, regeneration: 1 });
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/webm",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Session recording 2026-11-23 · Part 1",
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
  const dependencies = {
    provider: syntheticProvider(syntheticSettings("synthetic-aux-owner")),
    store,
    prepareAudio,
  };
  const runId = await scheduleCaptureTranscription(db, x.ctx, source.assetId, dependencies);
  if (!runId) throw new Error("Expected a capture transcription run");
  runIds.push(runId);
  return {
    kind: "proc.capture_transcription",
    runId,
    target: { userId: x.ctx.userId, subjectId: source.assetId },
    definition: captureTranscriptionJob(dependencies),
    broken: captureTranscriptionJob({
      ...dependencies,
      provider: syntheticProvider(syntheticSettings("synthetic-aux-owner-changed")),
    }),
  };
}

/** A class audio source with speaker-labelled transcript turns and its explicit voice check run. */
async function voiceSubject(): Promise<Subject> {
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
  await configureCostPolicy(
    db,
    {
      version: "synthetic-aux-owner",
      currency: "USD",
      killSwitch: false,
      limits: { session: 1e8, userMonth: 1e8, systemDay: 1e8, systemMonth: 1e8 },
    },
    { actorId: "synthetic", reason: "Synthetic auxiliary owner integration" },
  );
  // The source keeps no original here, so the check reads the transcript labels instead.
  const diarize = async (): Promise<VoiceDiarization> => {
    throw new Error("original_audio_unavailable");
  };
  const dependencies = {
    provider: syntheticProvider(syntheticSettings("synthetic-aux-owner")),
    diarize,
  };
  const runId = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey: randomUUID(),
  });
  runIds.push(runId);
  return {
    kind: "proc.voice_analysis",
    runId,
    target: { userId: x.ctx.userId, subjectId: x.session.id },
    definition: voiceAnalysisJob(dependencies),
    broken: voiceAnalysisJob({
      ...dependencies,
      provider: syntheticProvider(syntheticSettings("synthetic-aux-owner-changed")),
    }),
  };
}

type Logged = { event: string } & Record<string, LogValue>;

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

interface Round {
  /** The injected clock of the round (milliseconds); it decides which job is due. */
  at: number;
  /** The clock while a handler runs, so a continuation it adds is due only later. */
  during?: number;
  /** Another definition of the same kind, e.g. `broken`. */
  definition?: JobDefinition<AuxPayload>;
  /** How many jobs the round runs at most (default one). */
  jobs?: number;
  /** After the handler, its lease runs out unrenewed: the runner's completeJob then refuses. */
  loseLease?: boolean;
  /**
   * Before the handler, its lease runs out unrenewed and the sweep and another claim take the
   * same job (B): the handler then runs as a zombie with the same id and a stale lease.
   */
  zombie?: boolean;
}

/** One round of the real PLT runner over this subject's jobs only (its target). */
async function round(s: Subject, r: Round) {
  let clock = r.at;
  const ran: string[] = [];
  const logs: Logged[] = [];
  const claims: ClaimedJob[] = [];
  const real = r.definition ?? s.definition;
  const wrapped: JobDefinition<AuxPayload> = {
    ...real,
    async run(payload, job) {
      ran.push(job.job.id);
      try {
        if (r.zombie) {
          await leaseEnded(job.job.id);
          await sweepJobs(db, new Date(clock));
          claims.push(...(await claimJobs(db, [real.kind], 1, new Date(clock), s.target)));
        }
        if (r.during !== undefined) clock = r.during;
        await real.run(payload, job);
        if (r.loseLease) await leaseEnded(job.job.id);
      } finally {
        // Past the round's deadline: the runner claims nothing more.
        if (ran.length >= (r.jobs ?? 1)) clock = r.at + 24 * 60 * MINUTE;
      }
    },
  };
  await runDueJobs(db, [wrapped], {
    now: () => new Date(clock),
    deadline: new Date(r.at + MINUTE),
    // Too little time for a provider call: the capture job continues instead.
    finishBy: new Date(r.at + 1000),
    kinds: [real.kind],
    target: s.target,
    leaseRenewalMs: r.loseLease || r.zombie ? 3_600_000 : 250,
    log: (_level, event, fields) => logs.push({ ...fields, event }),
  });
  return { ran, logs, claims, standAsides: logs.filter((line) => line.event === NOT_OWNER) };
}

/** What the guarded writes could change: the run, its pointer and hold, its jobs and checkpoints. */
async function observe(s: Subject) {
  const run = await db
    .selectFrom("proc.processing_run")
    .select(["job_id", "state", "last_error", "reservation_id"])
    .where("id", "=", s.runId)
    .executeTakeFirstOrThrow();
  const jobs = await db
    .selectFrom("plt.job")
    .select(["id", "state", "singleton_key", "lease_token"])
    .where(sql<string>`payload->>'runId'`, "=", s.runId)
    .orderBy("created_at")
    .execute();
  const hold = await db
    .selectFrom("quota.reservation")
    .select(["closed_at", "settled_amounts"])
    .where("id", "=", run.reservation_id)
    .executeTakeFirstOrThrow();
  const steps = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", s.runId)
    .orderBy("step")
    .execute();
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select("id")
    .where("run_id", "=", s.runId)
    .execute();
  const job = (id: string | null | undefined) => jobs.find((item) => item.id === id);
  return {
    pointer: run.job_id,
    state: run.state,
    lastError: run.last_error,
    hold,
    jobs,
    job,
    steps: steps.map((row) => row.step),
    attempts: attempts.length,
  };
}

const LIVE = ["queued", "processing"];

const makers = {
  "proc.capture_transcription": captureSubject,
  "proc.voice_analysis": voiceSubject,
} as const;
type Kind = keyof typeof makers;

it.each([
  [
    "aux owner proc.capture_transcription: retry after the continuation keeps the pointer",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: retry after the continuation keeps the pointer",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    // J hands the run on to J2 and commits; its authority then ends before completeJob.
    const first = await round(s, { at: base + 10 * MINUTE, loseLease: true });
    const [j] = first.ran;
    expect(first.ran).toHaveLength(1);
    expect(first.logs).toContainEqual(
      expect.objectContaining({ event: "job_lease_lost", job_id: j }),
    );
    const handed = await observe(s);
    const j2 = handed.pointer;
    expect(j2).toBeTruthy();
    expect(j2).not.toBe(j);
    expect(handed.job(j2)?.singleton_key).toBe(`${s.runId}:${j}`);
    expect(handed.jobs).toHaveLength(2);
    // The sweep returns J and the next claim takes it again; its retry reaches the same builder.
    const retry = await round(s, { at: base + 5 * MINUTE });
    expect(retry.ran).toEqual([j]);
    const after = await observe(s);
    expect(after.pointer).toBe(j2);
    expect(after.job(j2)?.state).toBe("queued");
    expect(after.jobs.map((item) => item.id)).toEqual(handed.jobs.map((item) => item.id));
    expect(LIVE).toContain(after.state);
    expect(after.lastError).toBeNull();
    expect(after.hold.closed_at).toBeNull();
    // A valid non-owner ends as a success with nothing done, and says so once.
    expect(after.job(j)?.state).toBe("succeeded");
    expect(retry.standAsides).toEqual([
      expect.objectContaining({
        kind: s.kind,
        job_id: j,
        attempt: 2,
        code: "continuation_exists",
        reason: "continue",
      }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: J2 to J3 chain keeps the pointer on the live continuation",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: J2 to J3 chain keeps the pointer on the live continuation",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    const first = await round(s, { at: base + 10 * MINUTE, loseLease: true });
    const [j] = first.ran;
    const j2 = (await observe(s)).pointer;
    // J2 runs as the owner and hands on to J3, due later; its authority then ends too.
    const second = await round(s, {
      at: base + 20 * MINUTE,
      during: base + 30 * MINUTE,
      loseLease: true,
    });
    expect(second.ran).toEqual([j2]);
    expect(second.standAsides).toEqual([]);
    const chained = await observe(s);
    const j3 = chained.pointer;
    expect(j3).toBeTruthy();
    expect([j, j2]).not.toContain(j3);
    expect(chained.job(j3)?.singleton_key).toBe(`${s.runId}:${j2}`);
    expect(chained.jobs).toHaveLength(3);
    // Both earlier jobs are claimed again (J3 is not due yet); neither moves the pointer back.
    const retries = await round(s, { at: base + 25 * MINUTE, jobs: 2 });
    expect(retries.ran).toEqual([j, j2]);
    const after = await observe(s);
    expect(after.pointer).toBe(j3);
    expect(after.job(j3)?.state).toBe("queued");
    expect(after.jobs.map((item) => item.id)).toEqual(chained.jobs.map((item) => item.id));
    expect(LIVE).toContain(after.state);
    expect(after.lastError).toBeNull();
    expect(after.hold.closed_at).toBeNull();
    expect(retries.standAsides.map((line) => line.job_id)).toEqual([j, j2]);
    // The live continuation still carries the run on as its owner.
    const owner = await round(s, { at: base + 40 * MINUTE });
    expect(owner.ran).toEqual([j3]);
    expect(owner.standAsides).toEqual([]);
    const carried = await observe(s);
    if (kind === "proc.voice_analysis") {
      // Its corrections are saved: J3 ends the run.
      expect(carried.state).toBe("ready");
      expect(carried.pointer).toBe(j3);
    } else {
      // Still no time for a provider call: J3 hands on to J4.
      expect(carried.state).toBe("processing");
      expect(carried.job(carried.pointer)?.singleton_key).toBe(`${s.runId}:${j3}`);
    }
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: zombie with the same id and a stale lease writes nothing",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: zombie with the same id and a stale lease writes nothing",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    if (kind === "proc.capture_transcription") {
      // The chunk plan is saved first, so the zombie reaches the builder with nothing to prepare.
      const first = await round(s, { at: base + 10 * MINUTE });
      expect(first.standAsides).toEqual([]);
    }
    const before = await observe(s);
    const zombie = before.pointer;
    // The zombie's lease runs out; the sweep and claim B take the same job before it acts. (The
    // voice check saves its private analysis before the builder; that save is voice-processing's,
    // outside P12-06; what is checked here is the run, pointer, jobs, checkpoints and hold.)
    const stale = await round(s, { at: base + 20 * MINUTE, zombie: true });
    expect(stale.ran).toEqual([zombie]);
    const [b] = stale.claims;
    expect(b?.id).toBe(zombie);
    const after = await observe(s);
    expect(after.pointer).toBe(zombie);
    expect(after.state).toBe(before.state);
    expect(after.lastError).toBeNull();
    expect(after.hold).toEqual(before.hold);
    expect(after.steps).toEqual(before.steps);
    expect(after.attempts).toBe(before.attempts);
    expect(after.jobs.map((item) => item.id)).toEqual(before.jobs.map((item) => item.id));
    // Claim B is untouched: the zombie forced no state on the job.
    expect(after.job(zombie)).toMatchObject({ state: "running", lease_token: b?.token });
    expect(stale.standAsides).toEqual([
      expect.objectContaining({
        kind: s.kind,
        job_id: zombie,
        code: "job_lease_lost",
        reason: "fail",
      }),
    ]);
    expect(stale.logs).toContainEqual(
      expect.objectContaining({ event: "job_lease_lost", job_id: zombie }),
    );
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: zero-row pointer update commits no continuation and no checkpoint",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: zero-row pointer update commits no continuation and no checkpoint",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    const j = (await observe(s)).pointer;
    // Another writer (F-4, outside P12-06) moved the pointer to a job of the same run, due later.
    const sibling = await db.transaction().execute((tx) =>
      enqueueJob(tx, s.definition, {
        payload: { runId: s.runId, userId: s.target.userId, subjectId: s.target.subjectId },
        singletonKey: `${s.runId}:another-writer`,
        now: new Date(),
        runAt: new Date(base + 24 * 60 * MINUTE),
        defaults: DEFAULT_PLT_SETTINGS.jobs,
      }),
    );
    if (!sibling) throw new Error("Expected the other writer's job");
    await db
      .updateTable("proc.processing_run")
      .set({ job_id: sibling })
      .where("id", "=", s.runId)
      .execute();
    const before = await observe(s);
    // J, with a valid claim, reaches the builder: its conditional pointer write changes no row.
    const own = await round(s, { at: base + 10 * MINUTE });
    expect(own.ran).toEqual([j]);
    const after = await observe(s);
    expect(after.pointer).toBe(sibling);
    expect(after.jobs.map((item) => item.id)).toEqual([j, sibling]);
    expect(after.jobs.some((item) => item.singleton_key === `${s.runId}:${j}`)).toBe(false);
    // Capture: the fresh chunk plan was to be saved with the move; it rolled back with it.
    expect(after.steps).toEqual(before.steps);
    expect(after.state).toBe(before.state);
    expect(after.lastError).toBeNull();
    expect(after.hold.closed_at).toBeNull();
    expect(after.job(j)?.state).toBe("succeeded");
    expect(own.standAsides).toEqual([
      expect.objectContaining({
        kind: s.kind,
        job_id: j,
        code: "pointer_moved",
        reason: "continue",
      }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: lease loss in the error path does not fail the run or settle the allowance",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: lease loss in the error path does not fail the run or settle the allowance",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    // J hands on to J2 as the owner; J2 is the live job of the run.
    await round(s, { at: base + 10 * MINUTE });
    const before = await observe(s);
    const j2 = before.pointer;
    // J2 meets a real error (settings changed) only after its claim became void (B holds it).
    const failing = await round(s, {
      at: base + 20 * MINUTE,
      definition: s.broken,
      zombie: true,
    });
    expect(failing.ran).toEqual([j2]);
    const [b] = failing.claims;
    expect(b?.id).toBe(j2);
    const after = await observe(s);
    expect(LIVE).toContain(after.state);
    expect(after.lastError).toBeNull();
    expect(after.hold).toEqual({ closed_at: null, settled_amounts: null });
    expect(after.pointer).toBe(j2);
    expect(after.jobs.map((item) => item.id)).toEqual(before.jobs.map((item) => item.id));
    expect(after.job(j2)).toMatchObject({ state: "running", lease_token: b?.token });
    expect(failing.standAsides).toEqual([
      expect.objectContaining({ job_id: j2, code: "job_lease_lost", reason: "fail" }),
    ]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: legacy null pointer is not taken over",
    "proc.capture_transcription",
  ],
  ["aux owner proc.voice_analysis: legacy null pointer is not taken over", "proc.voice_analysis"],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    const j = (await observe(s)).pointer;
    // Data left by older code: a live run whose pointer is empty.
    await db
      .updateTable("proc.processing_run")
      .set({ job_id: null })
      .where("id", "=", s.runId)
      .execute();
    const before = await observe(s);
    // J proves no ownership at the builder: it hands nothing on and takes nothing over.
    const first = await round(s, { at: base + 10 * MINUTE, loseLease: true });
    expect(first.ran).toEqual([j]);
    expect(first.standAsides).toEqual([
      expect.objectContaining({ job_id: j, code: "pointer_moved", reason: "continue" }),
    ]);
    // Claimed again, J meets a real error: still no owner, so the run is not failed.
    const failing = await round(s, { at: base + 5 * MINUTE, definition: s.broken });
    expect(failing.ran).toEqual([j]);
    expect(failing.standAsides).toEqual([
      expect.objectContaining({ job_id: j, code: "not_owner", reason: "fail" }),
    ]);
    const after = await observe(s);
    expect(after.pointer).toBeNull();
    expect(after.state).toBe(before.state);
    expect(after.lastError).toBeNull();
    expect(after.hold).toEqual({ closed_at: null, settled_amounts: null });
    expect(after.steps).toEqual(before.steps);
    expect(after.attempts).toBe(0);
    expect(after.jobs.map((item) => item.id)).toEqual([j]);
  },
  TEST_TIMEOUT_MS,
);

it.each([
  [
    "aux owner proc.capture_transcription: valid owner moves the pointer and still fails the run on a real error",
    "proc.capture_transcription",
  ],
  [
    "aux owner proc.voice_analysis: valid owner moves the pointer and still fails the run on a real error",
    "proc.voice_analysis",
  ],
] as [string, Kind][])(
  "%s",
  async (_name, kind) => {
    const s = await makers[kind]();
    const base = Date.now();
    const j = (await observe(s)).pointer;
    const first = await round(s, { at: base + 10 * MINUTE });
    expect(first.ran).toEqual([j]);
    expect(first.standAsides).toEqual([]);
    const handed = await observe(s);
    const j2 = handed.pointer;
    expect(j2).toBeTruthy();
    expect(j2).not.toBe(j);
    expect(handed.job(j2)?.singleton_key).toBe(`${s.runId}:${j}`);
    expect(handed.state).toBe("processing");
    expect(handed.job(j)?.state).toBe("succeeded");
    // The owner's real error fails the run and releases its hold, as before.
    const failing = await round(s, { at: base + 20 * MINUTE, definition: s.broken });
    expect(failing.ran).toEqual([j2]);
    expect(failing.standAsides).toEqual([]);
    const after = await observe(s);
    expect(after.state).toBe("failed");
    expect(after.lastError).toBe("validation_failed");
    expect(after.hold.closed_at).not.toBeNull();
    expect(after.pointer).toBe(j2);
    expect(after.job(j2)?.state).toBe("succeeded");
  },
  TEST_TIMEOUT_MS,
);
