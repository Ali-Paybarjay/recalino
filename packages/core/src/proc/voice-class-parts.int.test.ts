/**
 * Second audit pass (2026-10-12, problem 4): one speaker namespace per class, proven through the
 * real worker path with a synthetic class of six recording parts, three people, one far-mic part
 * and diarizer fragments. Vectors are generated; no person is recorded.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import {
  cleanupFixtureProcessingJobs,
  runFixtureProcessingJobs,
  runFixtureProcessingStep,
} from "../../test/processing-jobs";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import type { AiProvider, ProviderResult, ProviderSettings, StructuredInput } from "../aip";
import { createDatabase } from "../db";
import { renderClassNotesHtml } from "../lkm";
import { type LearnerContext, MemoryObjectStore, writeOwnedObject } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import {
  changeClassVoiceIdentity,
  changeVoiceLine,
  enableVoice,
  getClassVoice,
  getVoiceEnrollment,
  projectVerifiedSpeech,
  saveVoiceSample,
  VOICE_ACCEPTANCE_POLICIES,
  VOICE_CONSENT_VERSION,
} from "../voc";
import { type RunSource, sourceSnapshotSchema } from "./contracts";
import { createProcessingRun, getRun } from "./runs";
import { scheduleVoiceReanalysis, voiceAnalysisJob } from "./voice-jobs";
import {
  analyzeVoiceSources,
  processVoiceSource,
  type VoiceDiarization,
  type VoiceDiarizer,
} from "./voice-processing";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const fixtureRunIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, fixtureRunIds);
  } finally {
    await db.destroy();
  }
});
afterEach(() => vi.unstubAllEnvs());

const MODEL = "synthetic-class-parts";
const DIM = 16;
const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const axis = (i: number, w = 1) => Array.from({ length: DIM }, (_, k) => (k === i ? w : 0));
const add = (...vs: number[][]) =>
  unit(Array.from({ length: DIM }, (_, k) => vs.reduce((sum, v) => sum + (v[k] ?? 0), 0)));
/** Three people: teacher, learner, classmate. The sample is the learner's near-field voice. */
const TEACHER = axis(0),
  LEARNER = axis(1),
  CLASSMATE = axis(2);
const SAMPLE = add(LEARNER, axis(9, 0.3));
const LEARNER_TURN = add(LEARNER, axis(10, 0.2));
const TEACHER_TURN = add(TEACHER, axis(11, 0.2));

/** A part's voice of one person: slightly different each part; the far-mic part is much noisier. */
function heard(person: number[], part: number): number[] {
  return part === 5 ? add(person, axis(14, 0.55), axis(15, 0.3)) : add(person, axis(4 + part, 0.1));
}
const learnerPrint = (part: number) => part === 0 || part === 3 || part === 6;
const classmatePrint = (part: number) => part === 2 || part === 5;
/** Parts where the learner only speaks in short turns, merged into the teacher's voice. */
const merged = (part: number) => part === 1 || part === 4;

function partDiarization(part: number): VoiceDiarization {
  const seg = (speakerId: string, startMs: number, endMs: number) => ({
    speakerId,
    startMs,
    endMs,
    overlap: false,
    boundaryUnsafe: false,
  });
  return {
    modelRevision: MODEL,
    segments: [
      seg("t", 1000, merged(part) ? 44000 : 31000),
      seg("t", 45000, 75000),
      seg("t", 89000, 119000),
      ...(learnerPrint(part) ? [seg("l", 32000, 44000)] : []),
      ...(classmatePrint(part) ? [seg("c", 76000, 88000)] : []),
      // Fragments: under a second each, no voiceprint, no excerpt, no line.
      seg("f1", 44200, 44900),
      seg("f2", 88200, 88900),
      ...(part === 5 ? [seg("f3", 75200, 75900)] : []),
    ],
    speakers: [
      { speakerId: "t", cleanSpeechMs: 90000, embedding: heard(TEACHER, part) },
      ...(learnerPrint(part)
        ? [{ speakerId: "l", cleanSpeechMs: 24000, embedding: heard(LEARNER, part) }]
        : []),
      ...(classmatePrint(part)
        ? [{ speakerId: "c", cleanSpeechMs: 24000, embedding: heard(CLASSMATE, part) }]
        : []),
    ],
    turns: [
      { speakerId: "t", startMs: 2000, endMs: 8000, embedding: TEACHER_TURN },
      ...(merged(part)
        ? [
            { speakerId: "t", startMs: 33000, endMs: 35000, embedding: LEARNER_TURN },
            { speakerId: "t", startMs: 46000, endMs: 48000, embedding: LEARNER_TURN },
          ]
        : []),
    ],
  };
}
function partTranscript(part: number): Pick<RunSource, "units" | "blocks"> {
  const units: RunSource["units"] = [
    { id: "ut", kind: "time", start: 2000, end: 8000, status: "extracted" },
  ];
  const blocks: RunSource["blocks"] = [
    { id: "bt", kind: "transcript", unitId: "ut", text: "Open your books at page ten." },
  ];
  if (learnerPrint(part)) {
    units.push({ id: "ul0", kind: "time", start: 33000, end: 36000, status: "extracted" });
    blocks.push({ id: "bl0", kind: "transcript", unitId: "ul0", text: "I am from Isfahan." });
  }
  if (merged(part)) {
    units.push(
      { id: "ul1", kind: "time", start: 33000, end: 35000, status: "extracted" },
      { id: "ul2", kind: "time", start: 46000, end: 48000, status: "extracted" },
    );
    blocks.push(
      { id: "bl1", kind: "transcript", unitId: "ul1", text: "I goes there." },
      { id: "bl2", kind: "transcript", unitId: "ul2", text: "I goes there." },
    );
  }
  if (classmatePrint(part)) {
    units.push({ id: "uc", kind: "time", start: 77000, end: 80000, status: "extracted" });
    blocks.push({ id: "bc", kind: "transcript", unitId: "uc", text: "We have a test on Monday." });
  }
  return { units, blocks };
}

const settings: ProviderSettings = {
  version: "voice-parts-fixture",
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
/** Answers only the private correction request, with the mistake of each "I goes there." line. */
class PartsProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  corrections = 0;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    if (input.schemaName !== "spoken_mistake_candidates")
      throw new Error(`Unexpected paid request ${input.schemaName}`);
    this.corrections++;
    const data = JSON.parse(input.input) as {
      explanationLanguage: string;
      utterances: { id: string; speakerId: string; text: string }[];
    };
    const bySpeaker = new Map<string, string[]>();
    for (const item of data.utterances)
      if (item.text === "I goes there.")
        bySpeaker.set(item.speakerId, [...(bySpeaker.get(item.speakerId) ?? []), item.id]);
    const output = input.schema.parse({
      candidates: [...bySpeaker].map(([speakerId, ids]) => ({
        speakerId,
        mistakes: ids.map((utteranceId) => ({
          utteranceId,
          said: "I **goes** there.",
          correct: "I go there.",
          whyFa:
            data.explanationLanguage === "fa"
              ? "با I فعل بدون s می‌آید."
              : "With I the verb takes no s.",
          kind: "grammar",
          teacherCorrected: false,
        })),
      })),
    });
    return {
      output,
      requestId: "synthetic-parts-correction",
      provider: this.name,
      model: input.model,
      actualMicros: 10,
      usage: { inputTokens: 20, outputTokens: 20 },
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("Cached fixture cannot transcribe");
  }
  async speech(): Promise<never> {
    throw new Error("No TTS in voice matching");
  }
}

async function addPart(
  ctx: LearnerContext,
  sessionId: string,
  part: number,
  store: MemoryObjectStore,
) {
  const now = new Date();
  const source = await db
    .insertInto("src.asset")
    .values({
      user_id: ctx.userId,
      kind: "audio",
      declared_mime: "audio/mpeg",
      verified_mime: "audio/mpeg",
      duration_ms: 120000,
      size_bytes: 1000,
      sha256: "a".repeat(64),
      display_name: `Synthetic class part ${part + 1}`,
      contract_version: "1",
      retention: "device_only",
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
      session_id: sessionId,
      asset_id: source.id,
      role: "class_audio",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, ctx, source.id, {
      schemaVersion: "1",
      provenance: "machine_extraction",
      originKey: `voice-parts:${source.id}`,
      settings: { ranges: [] },
      ...partTranscript(part),
    }),
  );
  // A live temporary original (D29) lets the class check and an explicit re-check read "audio".
  const objectId = await writeOwnedObject(db, store, ctx, {
    module: "src",
    retention: "temporary",
    contentType: "audio/mpeg",
    bytes: new Uint8Array([0x49, 0x44, 0x33]),
    now,
  });
  await db
    .insertInto("src.audio_upload")
    .values({
      user_id: ctx.userId,
      asset_id: source.id,
      reservation_id: randomUUID(),
      object_id: objectId,
      state: "verified",
      actual_duration_ms: 120000,
      expires_at: new Date(now.getTime() + 3600_000),
    })
    .execute();
  return source.id;
}

async function classFixture(parts = 6) {
  const x = await studyFixture(db);
  const store = new MemoryObjectStore();
  const enrollment = await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  await saveVoiceSample(db, store, x.ctx, {
    profileVersion: enrollment.version,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 24660,
    modelVersion: MODEL,
    embedding: SAMPLE,
  });
  const sources: string[] = [];
  for (let part = 0; part < parts; part++)
    sources.push(await addPart(x.ctx, x.session.id, part, store));
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 5000, document: 100, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "fixture",
    reason: "Synthetic class parts",
  });
  await configureCostPolicy(
    db,
    {
      version: "voice-parts-fixture",
      currency: "USD",
      killSwitch: false,
      limits: { session: 1e8, userMonth: 1e8, systemDay: 1e8, systemMonth: 1e8 },
    },
    { actorId: "fixture", reason: "Synthetic class parts" },
  );
  const provider = new PartsProvider();
  const calls: { sourceId: string; options: unknown }[] = [];
  const delays = new Map<string, number>();
  const diarize = vi.fn<VoiceDiarizer>(async ({ source, options }) => {
    calls.push({ sourceId: source.sourceId, options });
    const delay = delays.get(source.sourceId);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return partDiarization(sources.indexOf(source.sourceId));
  });
  return { ...x, store, provider, diarize, calls, delays, sources, enrollment };
}
type Fixture = Awaited<ReturnType<typeof classFixture>>;

/** The class run as the worker runs it, with extraction cached as the voice fixture does. */
async function runClass(x: Fixture) {
  const definition = processingJob({
    provider: x.provider,
    store: x.store,
    diarizeVoice: x.diarize,
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider: x.provider, job: definition },
  );
  fixtureRunIds.push(run.id);
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  for (const source of snapshot.sources) {
    expect(source.objectId).toBeTruthy();
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
  await runFixtureProcessingJobs(db, definition, { userId: x.ctx.userId, sessionId: x.session.id });
  return { run, snapshot };
}
/** The view lists parts by source id; tests address them by recording order. */
const byPart = (x: Fixture, view: Awaited<ReturnType<typeof getClassVoice>>) =>
  x.sources.map((sourceId) => {
    const analysis = view.analyses.find((item) => item.sourceId === sourceId);
    if (!analysis) throw new Error(`analysis of part missing: ${sourceId}`);
    return analysis;
  });
const summary = (view: Awaited<ReturnType<typeof getClassVoice>>) =>
  (view.classVoices ?? [])
    .map((voice) => ({
      id: voice.id,
      label: voice.label,
      ambiguous: voice.ambiguous,
      members: [...voice.members.map((member) => member.speakerId)].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

it("PRD-SPK-02 audit: six parts, three people and 13 fragments become three class voices, asked once, through the worker", async () => {
  // The wider background plan is set from the start: the lesson's own check must ignore it.
  vi.stubEnv(
    "VOICE_SETTINGS_JSON",
    JSON.stringify({ backgroundCoverage: { windowMs: 58000, maxWindows: 16 } }),
  );
  const x = await classFixture();
  const { run } = await runClass(x);
  expect((await getRun(db, x.ctx, run.id)).state).toBe("ready");
  expect(x.diarize).toHaveBeenCalledTimes(6);
  // Item 5: the class run never widens coverage; target turns follow their switch.
  for (const call of x.calls) expect(call.options).toEqual({ targetTurnMinMs: 1500 });

  const view = await getClassVoice(db, x.ctx, x.session.id);
  expect(view.analyses).toHaveLength(6);
  // Item 2, diagnosis "23 speakers / 17 without clip": many part-level voices, few class voices.
  const partVoices = view.analyses.flatMap((analysis) => analysis.candidates);
  const shortIds = view.analyses.flatMap((analysis) => analysis.shortCandidateIds ?? []);
  expect(partVoices.length).toBe(23);
  expect(shortIds).toHaveLength(13);
  for (const analysis of view.analyses) {
    expect(analysis.candidateId).not.toBeNull();
    expect(analysis.shortCandidateIds).not.toContain(analysis.candidateId);
    for (const id of analysis.shortCandidateIds ?? [])
      expect(analysis.candidates.find((item) => item.id === id)?.clips).toEqual([]);
    expect(analysis.status).toBe("unverified");
    expect(analysis.verificationMethod).toBeNull();
  }
  // Item 1: exactly three class voices, none ambiguous, with the far-mic part linked too.
  expect(view.classVoices).toHaveLength(3);
  const members = (view.classVoices ?? []).map((voice) => voice.members.length).sort();
  expect(members).toEqual([2, 2, 6]);
  expect((view.classVoices ?? []).every((voice) => !voice.ambiguous)).toBe(true);
  const parts = byPart(x, view);
  const learnerVoice = (view.classVoices ?? []).find(
    (voice) =>
      voice.members.some((member) => member.analysisId === parts[0]?.id) &&
      voice.members.some((member) => member.analysisId === parts[3]?.id) &&
      voice.members.length === 2 &&
      voice.label === "Voice 1",
  );
  expect(learnerVoice).toBeDefined();
  expect(view.classCandidateId).toBe(learnerVoice?.id);
  const teacherVoice = (view.classVoices ?? []).find((voice) => voice.members.length === 6);
  expect(teacherVoice?.id).not.toBe(view.classCandidateId);
  // Item 3 / D54: no evaluated policy, nothing accepted automatically.
  expect(VOICE_ACCEPTANCE_POLICIES).toHaveLength(0);

  // Item 3: the learner's two short turns merged into the teacher's voice are proposed; the
  // teacher's own lines are not (recall 4/4, precision 4/4 on this synthetic class).
  const proposed = view.analyses.flatMap((analysis) =>
    (analysis.lines ?? []).filter((line) => line.proposed).map((line) => line.text),
  );
  expect(proposed).toEqual(["I goes there.", "I goes there.", "I goes there.", "I goes there."]);
  // Item 5 / FR-VOC-008: one paid correction per part with repeatable evidence, none elsewhere.
  expect(x.provider.corrections).toBe(2);
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["step", "state"])
    .where("run_id", "=", run.id)
    .execute();
  expect(attempts).toHaveLength(2);
  expect(new Set(attempts.map((item) => item.step)).size).toBe(2);
  // Item 6: no turn voiceprint is stored anywhere in the analysis rows.
  const rows = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("session_id", "=", x.session.id)
    .execute();
  const turnValue = LEARNER_TURN[1]?.toFixed(6);
  for (const row of rows) {
    expect(JSON.stringify(row.utterances)).not.toContain(turnValue);
    expect(JSON.stringify(row.candidates)).not.toContain("embedding");
    expect(JSON.stringify(row.speaker_links)).not.toContain("[");
    for (const entry of row.private_embeddings as { speakerId: string }[])
      expect(row.candidates as { id: string }[]).toContainEqual(
        expect.objectContaining({ id: entry.speakerId }),
      );
  }

  // A line marked "mine" shows its checked mistake under the strict evidence rule; before that,
  // nothing from the unconfirmed class is shown.
  const model = referenceStudyModel();
  model.language.explanation = "en";
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).not.toContain("I go there.");
  const mergedPart = parts[1];
  if (!mergedPart) throw new Error("part missing");
  const line = mergedPart.lines?.find((item) => item.proposed);
  if (!line) throw new Error("proposed line missing");
  await changeVoiceLine(db, x.ctx, x.session.id, {
    scope: "line",
    analysisId: mergedPart.id,
    expectedVersion: mergedPart.version,
    utteranceId: line.utteranceId,
    choice: "mine",
  });
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).toContain("I go there.");

  // One confirmation for the whole class: the two learner parts are verified, one reference.
  const current = await getClassVoice(db, x.ctx, x.session.id);
  await changeClassVoiceIdentity(db, x.ctx, x.session.id, {
    scope: "class",
    action: "confirm",
    classVoiceId: learnerVoice?.id ?? "",
    expected: current.analyses.map((item) => ({ analysisId: item.id, version: item.version })),
  });
  let after = await getClassVoice(db, x.ctx, x.session.id);
  expect(after.analyses.filter((item) => item.status === "verified")).toHaveLength(2);
  expect(after.analyses.every((item) => item.verificationMethod !== "automatic")).toBe(true);
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings.filter((e) => e.analysisId)).toHaveLength(
    1,
  );
  // Parts where the learner was never heard are not asked again (no suggestion left).
  expect(after.classCandidateId).toBeNull();
  // Item 6: repeating the same confirmation changes nothing.
  const repeated = await changeClassVoiceIdentity(db, x.ctx, x.session.id, {
    scope: "class",
    action: "confirm",
    classVoiceId: learnerVoice?.id ?? "",
    expected: after.analyses.map((item) => ({ analysisId: item.id, version: item.version })),
  });
  expect(repeated).toEqual([]);
  expect(
    (await getClassVoice(db, x.ctx, x.session.id)).analyses.map((item) => item.version),
  ).toEqual(after.analyses.map((item) => item.version));
  expect((await getVoiceEnrollment(db, x.ctx)).embeddings.filter((e) => e.analysisId)).toHaveLength(
    1,
  );

  // Item 1, incremental part (D60/D61): a seventh part saved under the same run joins the
  // confirmed class voice without changing its id, and is the only thing asked again.
  const seventh = await addPart(x.ctx, x.session.id, 6, x.store);
  x.sources.push(seventh);
  const snapshotSource = sourceSnapshotSchema.parse(
    (
      await db
        .selectFrom("proc.processing_run")
        .select("input_snapshot")
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow()
    ).input_snapshot,
  ).sources[0] as RunSource;
  const version = await db
    .selectFrom("src.content_version")
    .select("id")
    .where("asset_id", "=", seventh)
    .executeTakeFirstOrThrow();
  await processVoiceSource({
    db,
    ctx: x.ctx,
    sessionId: x.session.id,
    runId: run.id,
    source: {
      ...snapshotSource,
      sourceId: seventh,
      contentVersionId: version.id,
      objectId: randomUUID(),
      durationMs: 120000,
      ...partTranscript(6),
    },
    diarize: x.diarize,
    correct: async () => false,
    now: () => new Date(),
  });
  after = await getClassVoice(db, x.ctx, x.session.id);
  expect(after.analyses).toHaveLength(7);
  const joined = after.classVoices?.find((voice) => voice.id === learnerVoice?.id);
  expect(joined?.members).toHaveLength(3);
  expect(after.classCandidateId).toBe(learnerVoice?.id);
  expect(after.analyses.filter((item) => item.status === "verified")).toHaveLength(2);
  expect(byPart(x, after)[6]?.status).toBe("unverified");
  expect(
    byPart(x, after)
      .slice(0, 7)
      .map((item) => item.status),
  ).toEqual([
    "verified",
    "unverified",
    "unverified",
    "verified",
    "unverified",
    "unverified",
    "unverified",
  ]);

  // Item 1 and 5: an explicit re-check runs the voice job on all parts, in parallel, with the
  // wider plan, and reproduces the same class voices (ids and labels) — idempotent numbering.
  const before = summary(after);
  const dependencies = { provider: x.provider, diarize: x.diarize };
  x.calls.length = 0;
  const recheck = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey: randomUUID(),
  });
  fixtureRunIds.push(recheck);
  const job = voiceAnalysisJob(dependencies);
  for (let step = 0; step < 12 && (await getRun(db, x.ctx, recheck)).state !== "ready"; step++)
    await runFixtureProcessingStep(db, job, { runId: recheck, userId: x.ctx.userId });
  expect((await getRun(db, x.ctx, recheck)).state).toBe("ready");
  expect(x.calls).toHaveLength(7);
  for (const call of x.calls)
    expect(call.options).toEqual({
      plan: { windowMs: 58000, maxWindows: 16 },
      targetTurnMinMs: 1500,
    });
  const again = await getClassVoice(db, x.ctx, x.session.id);
  expect(summary(again)).toEqual(before);
  expect(again.analyses.every((item) => item.verificationMethod !== "automatic")).toBe(true);
  // One paid correction per analysis with evidence, across both runs: 2 + 2, never twice.
  expect(x.provider.corrections).toBe(4);
});

it("FR-VOC-002 audit: a far-mic voice alike to two people stays unlinked and visibly ambiguous", async () => {
  const x = await classFixture(2);
  // Part 2's teacher sounds like both the teacher and the classmate of part 1.
  x.diarize.mockImplementation(async ({ source }) => {
    const part = x.sources.indexOf(source.sourceId);
    const native = partDiarization(part === 0 ? 2 : 0);
    if (part === 1)
      native.speakers = native.speakers.map((speaker) =>
        speaker.speakerId === "t"
          ? { ...speaker, embedding: add(TEACHER, axis(2, 1), axis(13, 0.3)) }
          : speaker,
      );
    return native;
  });
  const runId = randomUUID();
  const snapshot = x.sources.map((sourceId, part) => ({
    sourceId,
    contentVersionId: null as string | null,
    part,
  }));
  for (const item of snapshot)
    item.contentVersionId = (
      await db
        .selectFrom("src.content_version")
        .select("id")
        .where("asset_id", "=", item.sourceId)
        .executeTakeFirstOrThrow()
    ).id;
  await analyzeVoiceSources({
    db,
    ctx: x.ctx,
    sessionId: x.session.id,
    runId,
    sources: snapshot.map((item) => ({
      sourceId: item.sourceId,
      contentVersionId: item.contentVersionId,
      kind: "audio" as const,
      sha256: "a".repeat(64),
      mimeType: "audio/mpeg",
      durationMs: 120000,
      pageCount: null,
      objectId: randomUUID(),
      captureAnchor: null,
      ranges: [],
      ...partTranscript(item.part === 0 ? 2 : 0),
    })),
    diarize: x.diarize,
    concurrency: 3,
    canStart: () => true,
    now: () => new Date(),
  });
  const view = await getClassVoice(db, x.ctx, x.session.id);
  const voices = view.classVoices ?? [];
  // Part 2's teacher is 0.69 alike to both part 1's teacher and part 1's classmate: no link is
  // made, and all three voices are marked ambiguous rather than one pair being guessed.
  const ambiguous = voices.filter((voice) => voice.ambiguous);
  expect(ambiguous).toHaveLength(3);
  expect(voices.every((voice) => voice.members.length === 1)).toBe(true);
});

it("audit item 4: six parts diarized side by side finish well before the sequential loop", async () => {
  const x = await classFixture();
  // The 2026-10-12 class scaled by 1/100: 8.8 s … 207 s per part, 411 s in all.
  const scaled = [88, 2070, 300, 500, 700, 450];
  for (const [index, sourceId] of x.sources.entries()) x.delays.set(sourceId, scaled[index] ?? 0);
  const versions = new Map<string, string>();
  for (const sourceId of x.sources)
    versions.set(
      sourceId,
      (
        await db
          .selectFrom("src.content_version")
          .select("id")
          .where("asset_id", "=", sourceId)
          .executeTakeFirstOrThrow()
      ).id,
    );
  const sources: RunSource[] = x.sources.map((sourceId, part) => ({
    sourceId,
    contentVersionId: versions.get(sourceId) ?? null,
    kind: "audio",
    sha256: "a".repeat(64),
    mimeType: "audio/mpeg",
    durationMs: 120000,
    pageCount: null,
    objectId: randomUUID(),
    captureAnchor: null,
    ranges: [],
    ...partTranscript(part),
  }));
  const sequentialStart = performance.now();
  const sequentialRun = randomUUID();
  for (const source of sources)
    await processVoiceSource({
      db,
      ctx: x.ctx,
      sessionId: x.session.id,
      runId: sequentialRun,
      source,
      diarize: x.diarize,
      correct: async () => false,
      now: () => new Date(),
    });
  const sequentialMs = performance.now() - sequentialStart;
  const parallelStart = performance.now();
  await analyzeVoiceSources({
    db,
    ctx: x.ctx,
    sessionId: x.session.id,
    runId: randomUUID(),
    sources,
    diarize: x.diarize,
    concurrency: 3,
    canStart: () => true,
    now: () => new Date(),
  });
  const parallelMs = performance.now() - parallelStart;
  console.info(
    `voice-class-parts timing: sequential ${Math.round(sequentialMs)} ms, parallel(3) ${Math.round(parallelMs)} ms`,
  );
  expect(sequentialMs).toBeGreaterThan(4000);
  expect(parallelMs).toBeLessThan(sequentialMs * 0.7);
  expect(x.diarize).toHaveBeenCalledTimes(12);
});
