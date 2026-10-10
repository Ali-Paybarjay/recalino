import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs, runFixtureProcessingStep } from "../../test/processing-jobs";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { studyFixture, syntheticKnowledge } from "../../test/study-fixture";
import { updateProfile } from "../acc";
import type { AiProvider, ProviderResult, ProviderSettings, StructuredInput } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import {
  changeVoiceIdentity,
  enableVoice,
  getClassVoice,
  getVoiceProfile,
  projectVerifiedSpeech,
  revokeVoiceData,
  saveVoiceSample,
  VOICE_CONSENT_VERSION,
} from "../voc";
import { sourceSnapshotSchema } from "./contracts";
import { createProcessingRun, getRun } from "./runs";
import {
  scheduleVoiceReanalysis,
  voiceAnalysisBlockedReason,
  voiceAnalysisJob,
  voiceProcessingStatus,
} from "./voice-jobs";
import { scopedVoiceSpeakerId, type VoiceDiarization } from "./voice-processing";
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
const settings: ProviderSettings = {
  version: "voice-pipeline-fixture",
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
class VoiceProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  onReply?: () => Promise<void>;
  /** When set, the lesson is generated here instead of being seeded as a cached checkpoint. */
  knowledge?: unknown;
  repair?: (input: StructuredInput<unknown>) => unknown;
  onCall?: (schemaName: string) => void;
  calls = vi.fn((input: StructuredInput<unknown>) => {
    this.onCall?.(input.schemaName);
    if (input.schemaName === "class_knowledge" && this.knowledge !== undefined)
      return this.knowledge;
    if (input.schemaName === "class_knowledge_repair" && this.repair) return this.repair(input);
    if (input.schemaName === "spoken_mistake_candidates") {
      const data = JSON.parse(input.input);
      const learner = data.utterances.find((item: { text: string }) =>
        item.text.includes("am agree"),
      );
      return {
        candidates: [
          {
            speakerId: learner.speakerId,
            mistakes: [
              {
                utteranceId: learner.id,
                said: "I am agree with you.",
                correct: "I agree with you.",
                whyFa:
                  data.explanationLanguage === "fa"
                    ? "فعل agree به am نیاز ندارد."
                    : "The verb agree does not need am.",
                kind: "grammar",
                teacherCorrected: false,
              },
            ],
          },
        ],
      };
    }
    throw new Error("Only private corrections may dispatch in this fixture");
  });
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    const output = input.schema.parse(this.calls(input));
    await this.onReply?.();
    return {
      output,
      requestId: "synthetic-voice-correction",
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
async function fixture(
  enabled: boolean,
  options: { processingOrigin?: boolean; labelledTranscript?: boolean; generated?: boolean } = {},
) {
  const x = await studyFixture(db);
  if (enabled) await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const source = await db
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
      asset_id: source.id,
      role: "class_audio",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, source.id, {
      schemaVersion: "1",
      provenance: "machine_extraction",
      originKey: options.processingOrigin
        ? `processing:${randomUUID()}:audio:${source.id}`
        : `voice-fixture:${source.id}`,
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
          ...(options.labelledTranscript
            ? { speakerId: scopedVoiceSpeakerId(source.id, "fixture", "teacher") }
            : {}),
        },
        {
          id: "learner-text",
          kind: "transcript",
          unitId: "learner",
          text: "I am agree with you.",
          ...(options.labelledTranscript
            ? { speakerId: scopedVoiceSpeakerId(source.id, "fixture", "learner") }
            : {}),
        },
        {
          id: "learner-repeat-text",
          kind: "transcript",
          unitId: "learner-repeat",
          text: "I am agree with you.",
          ...(options.labelledTranscript
            ? { speakerId: scopedVoiceSpeakerId(source.id, "fixture", "learner") }
            : {}),
        },
      ],
    }),
  );
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 2000, document: 100, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "fixture",
    reason: "Synthetic voice integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "voice-pipeline-fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "fixture", reason: "Synthetic voice integration" },
  );
  const provider = new VoiceProvider();
  const diarize = vi.fn(
    async (): Promise<VoiceDiarization> => ({
      modelRevision: "synthetic-two-voices",
      segments: [
        { speakerId: "0", startMs: 0, endMs: 20000, overlap: false, boundaryUnsafe: false },
        { speakerId: "1", startMs: 20000, endMs: 60000, overlap: false, boundaryUnsafe: false },
      ],
      speakers: [0, 1].map((speaker) => ({
        speakerId: String(speaker),
        cleanSpeechMs: 21000,
        embedding: Array.from({ length: 16 }, (_, i) => (i === speaker ? 1 : 0)),
      })),
    }),
  );
  const definition = processingJob({
    provider,
    store: new MemoryObjectStore(),
    diarizeVoice: diarize,
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job: definition },
  );
  fixtureRunIds.push(run.id);
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  // The fake diarizer consumes no bytes; this private cached original ID proves the orchestration path.
  const cachedSource = snapshot.sources[0];
  if (!cachedSource) throw new Error("Synthetic audio source missing");
  cachedSource.objectId = randomUUID();
  await db
    .insertInto("proc.run_step")
    .values({
      run_id: run.id,
      step: `source:${source.id}`,
      output: JSON.stringify(cachedSource),
      completed_at: new Date(),
    })
    .execute();
  const knowledge = {
    ...syntheticKnowledge(1),
    sourceClassifications: [
      { sourceId: source.id, classification: { role: "class_material", confidence: "high" } },
    ],
  };
  if (options.generated) provider.knowledge = knowledge;
  else
    await db
      .insertInto("proc.run_step")
      .values({
        run_id: run.id,
        step: "knowledge",
        output: JSON.stringify(knowledge),
        completed_at: new Date(),
      })
      .execute();
  const step = () =>
    runFixtureProcessingStep(db, definition, { runId: run.id, userId: x.ctx.userId });
  return { ...x, source, run, provider, diarize, step };
}

it("stages private speaker analysis and billed corrections before ordinary notes, keeping only a receipt in proc", async () => {
  const x = await fixture(true);
  await x.step();
  expect(x.diarize).toHaveBeenCalledTimes(1);
  expect(x.provider.calls).not.toHaveBeenCalled();
  await x.step();
  expect(x.provider.calls).toHaveBeenCalledTimes(1);
  const rows = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(rows).toHaveLength(1);
  const analysis = rows[0];
  if (!analysis) throw new Error("Synthetic voice analysis missing");
  expect(analysis.status).toBe("unverified");
  expect(JSON.stringify(analysis.mistakes)).toContain("I agree with you.");
  expect(JSON.stringify(analysis.mistakes)).toContain('"explanationLanguage":"en"');
  const correctionInput = x.provider.calls.mock.calls[0]?.[0];
  expect(JSON.parse(correctionInput?.input ?? "{}").explanationLanguage).toBe("en");
  const receipt = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", x.run.id)
    .where("step", "like", "voice:%")
    .executeTakeFirstOrThrow();
  expect(receipt.output).toEqual({ analysisId: analysis.id, complete: true });
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["state", "step"])
    .where("run_id", "=", x.run.id)
    .execute();
  expect(attempts).toEqual([{ state: "succeeded", step: `voice:corrections:${analysis.id}` }]);
  await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect(x.diarize).toHaveBeenCalledTimes(1);
  expect(x.provider.calls).toHaveBeenCalledTimes(1);
  expect(JSON.stringify((await getLatestVersion(db, x.ctx, x.session.id))?.model)).not.toContain(
    "I agree with you.",
  );
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses[0]?.status).toBe("unverified");
});

/** Diarization that waits until the named lesson call has been sent, or a fallback timeout. */
function gatedDiarization(
  x: Awaited<ReturnType<typeof fixture>>,
  native: VoiceDiarization,
  releaseOn: string,
) {
  const events: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
    setTimeout(resolve, 3000);
  });
  x.diarize.mockImplementation(async () => {
    events.push("diarize:start");
    await gate;
    events.push("diarize:end");
    return native;
  });
  x.provider.onCall = (name) => {
    events.push(name);
    if (name === releaseOn) release();
  };
  return events;
}

it("generates the lesson while the class's acoustic check runs, then corrects in a job of its own", async () => {
  const x = await fixture(true, { generated: true });
  const native = await x.diarize();
  x.diarize.mockClear();
  const events = gatedDiarization(x, native, "class_knowledge");
  await x.step();
  // The lesson call went out while the check was still running, in the same job.
  expect(events).toEqual(["diarize:start", "class_knowledge", "diarize:end"]);
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses).toHaveLength(1);
  await x.step();
  expect(events.at(-1)).toBe("spoken_mistake_candidates");
  await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect(x.diarize).toHaveBeenCalledTimes(1);
  expect(x.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_knowledge",
    "spoken_mistake_candidates",
  ]);
});

it("keeps repairing the lesson in the same job while the acoustic check still runs", async () => {
  const x = await fixture(true, { generated: true });
  const knowledge = structuredClone(x.provider.knowledge) as ReturnType<typeof syntheticKnowledge>;
  const summary = knowledge.summary[0];
  if (!summary) throw new Error("Synthetic summary missing");
  // A class claim without its evidence is a known, repairable failure.
  Object.assign(summary, { origin: "from_class", evidence: "audio", sourceRefs: [] });
  x.provider.knowledge = knowledge;
  x.provider.repair = () => {
    const claim = (id: string, text: string) => ({ id, text, evidenceKey: null, uncertain: false });
    return {
      schemaVersion: "1",
      title: "Synthetic study fixture",
      language: { learning: "en", explanation: "en" },
      summary: [claim("summary", "A synthetic explanation.")],
      topics: [],
      learningItems: [
        {
          id: "item-0",
          kind: "vocabulary",
          front: "Synthetic question 0",
          back: "Synthetic answer 0",
          claim: claim("claim-0", "Synthetic item 0"),
        },
      ],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
  };
  const native = await x.diarize();
  x.diarize.mockClear();
  const events = gatedDiarization(x, native, "class_knowledge_repair");
  await x.step();
  // Without the check the first rejected answer would end this job; here the repair follows.
  expect(events).toEqual([
    "diarize:start",
    "class_knowledge",
    "class_knowledge_repair",
    "diarize:end",
  ]);
  for (let step = 0; step < 4 && (await getRun(db, x.ctx, x.run.id)).state !== "ready"; step++)
    await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect(x.diarize).toHaveBeenCalledTimes(1);
  expect(x.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_knowledge",
    "class_knowledge_repair",
    "spoken_mistake_candidates",
  ]);
});

it("does not infer voices or dispatch private analysis unless the learner opted in", async () => {
  const x = await fixture(false);
  await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect(x.diarize).not.toHaveBeenCalled();
  expect(x.provider.calls).not.toHaveBeenCalled();
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses).toEqual([]);
});

it("uses the saved acoustic sample to rank a bounded class check, still asks on the first class, and preserves sampled coverage through corrections", async () => {
  const x = await fixture(true);
  await saveVoiceSample(db, new MemoryObjectStore(), x.ctx, {
    profileVersion: (await getVoiceProfile(db, x.ctx)).version ?? 0,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 24660,
    modelVersion: "synthetic-two-voices",
    embedding: [0, 1, ...Array<number>(14).fill(0)],
  });
  const native = await x.diarize();
  x.diarize.mockClear();
  x.diarize.mockResolvedValue({ ...native, sampled: true });
  await x.step();
  let view = (await getClassVoice(db, x.ctx, x.session.id)).analyses[0];
  expect(view).toMatchObject({ status: "unverified", reason: "sampled_audio" });
  expect(view?.candidates[0]?.score).toBe(1);
  expect(view?.candidates[1]?.score).toBe(0);
  expect(view?.candidates[0]?.lines).toContain("I am agree with you.");
  await x.step();
  view = (await getClassVoice(db, x.ctx, x.session.id)).analyses[0];
  expect(view?.reason).toBe("sampled_audio");
  const model = referenceStudyModel();
  model.language.explanation = "en";
  expect(JSON.stringify(await projectVerifiedSpeech(db, x.ctx, x.session.id, model))).not.toContain(
    "I agree with you.",
  );
  if (!view?.candidateId) throw new Error("Synthetic sample-ranked candidate missing");
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: view.id,
    expectedVersion: view.version,
    speakerId: view.candidateId,
  });
  expect(JSON.stringify(await projectVerifiedSpeech(db, x.ctx, x.session.id, model))).toContain(
    "I agree with you.",
  );
  expect(x.diarize).toHaveBeenCalledTimes(1);
});

it("refuses expired class audio with no usable speaker labels before creating another reservation or no-op check", async () => {
  const x = await fixture(false);
  await x.step();
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const before = await db
    .selectFrom("quota.reservation")
    .select("id")
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBe("original_audio_required");
  await expect(
    scheduleVoiceReanalysis(
      db,
      x.ctx,
      x.session.id,
      { provider: x.provider, diarize: x.diarize },
      { operationKey: randomUUID() },
    ),
  ).rejects.toMatchObject({ details: { fields: { voice: ["original_audio_required"] } } });
  expect(
    await db
      .selectFrom("quota.reservation")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  ).toEqual(before);
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  ).toEqual([{ id: x.run.id }]);
});

it("reports missing consent, transcript and selected sources before creating an analysis run", async () => {
  const x = await fixture(false);
  await x.step();
  const dependencies = { provider: x.provider, diarize: x.diarize };
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBe("consent_required");
  await expect(
    scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { voice: ["consent_required"] } },
  });
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  await db
    .updateTable("src.session_source")
    .set({ selected_content_version_id: null })
    .where("session_id", "=", x.session.id)
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBe("transcript_required");
  await expect(
    scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { voice: ["transcript_required"] } },
  });
  await db
    .updateTable("src.session_source")
    .set({ selected: false })
    .where("session_id", "=", x.session.id)
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBe("sources_unavailable");
  await expect(
    scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { sources: ["select_at_least_one"] } },
  });
  expect(
    await db
      .selectFrom("proc.processing_run")
      .select("id")
      .where("session_id", "=", x.session.id)
      .where("user_id", "=", x.ctx.userId)
      .execute(),
  ).toEqual([{ id: x.run.id }]);
  expect(x.diarize).not.toHaveBeenCalled();
  expect(x.provider.calls).not.toHaveBeenCalled();
  const other = await studyFixture(db);
  await expect(voiceAnalysisBlockedReason(db, other.ctx, x.session.id)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("preflights cached audio with the same selected ranges as the queue and permits transcript fallback", async () => {
  const x = await fixture(false, { processingOrigin: true, labelledTranscript: true });
  await x.step();
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  await db
    .updateTable("src.session_source")
    .set({ ranges: JSON.stringify([{ start: 0, end: 30000 }]) })
    .where("session_id", "=", x.session.id)
    .where("user_id", "=", x.ctx.userId)
    .execute();
  const dependencies = { provider: x.provider, diarize: x.diarize };
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBe("transcript_required");
  await expect(
    scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies),
  ).rejects.toMatchObject({ details: { fields: { voice: ["transcript_required"] } } });
  await db
    .updateTable("src.session_source")
    .set({ ranges: "[]" })
    .where("session_id", "=", x.session.id)
    .where("user_id", "=", x.ctx.userId)
    .execute();
  expect(await voiceAnalysisBlockedReason(db, x.ctx, x.session.id)).toBeNull();
  const runId = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey: randomUUID(),
  });
  fixtureRunIds.push(runId);
  expect((await getRun(db, x.ctx, runId)).state).toBe("queued");
  expect(x.diarize).not.toHaveBeenCalled();
  expect(x.provider.calls).not.toHaveBeenCalled();
});

it("charges a known provider result after consent is revoked in flight without restoring private data or blocking notes", async () => {
  const x = await fixture(true);
  await x.step();
  x.provider.onReply = () => revokeVoiceData(db, x.ctx);
  await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect((await getClassVoice(db, x.ctx, x.session.id)).analyses).toEqual([]);
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .select(["state", "error_code"])
    .where("run_id", "=", x.run.id)
    .executeTakeFirstOrThrow();
  expect(attempt).toEqual({ state: "failed", error_code: "provider_output_commit_failed" });
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("step")
      .where("run_id", "=", x.run.id)
      .where("step", "like", "voice:%")
      .execute(),
  ).toEqual([]);
  expect(x.provider.calls).toHaveBeenCalledTimes(1);
});

it("does not regenerate rejected text or loop when identity changes between correction and publication checkpoints", async () => {
  const x = await fixture(true);
  await x.step();
  await x.step();
  const row = await db
    .selectFrom("voc.analysis")
    .selectAll()
    .where("user_id", "=", x.ctx.userId)
    .executeTakeFirstOrThrow();
  const mistakes = row.mistakes as Record<string, unknown[]>;
  const speakerId = Object.keys(mistakes).find((id) => mistakes[id]?.length);
  if (!speakerId) throw new Error("Synthetic corrected speaker missing");
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "reject",
    analysisId: row.id,
    expectedVersion: row.version,
    speakerId,
  });
  await x.step();
  expect((await getRun(db, x.ctx, x.run.id)).state).toBe("ready");
  expect(x.provider.calls).toHaveBeenCalledTimes(1);
  const after = await db
    .selectFrom("voc.analysis")
    .select("mistakes")
    .where("id", "=", row.id)
    .executeTakeFirstOrThrow();
  expect(after.mistakes).not.toHaveProperty(speakerId);
});

it("deduplicates the same explicit analysis request after completion and exposes queued processing", async () => {
  const x = await fixture(false, { labelledTranscript: true });
  await x.step();
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);

  // An existing notebook keeps its explanation language after the account changes.
  await updateProfile(
    db,
    x.ctx,
    { field: "first_language", firstLanguage: "es" },
    { now: new Date() },
  );
  await updateProfile(
    db,
    x.ctx,
    {
      field: "explanation_language",
      explanationLanguage: "first_language",
    },
    { now: new Date() },
  );
  const dependencies = { provider: x.provider, diarize: x.diarize };
  const operationKey = randomUUID();
  const runId = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey,
  });
  fixtureRunIds.push(runId);
  const queued = await db
    .selectFrom("proc.processing_run")
    .select("settings")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  expect(queued.settings).toMatchObject({ explanationLanguage: "en" });
  expect(await voiceProcessingStatus(db, x.ctx, x.session.id)).toBe(true);
  expect(
    await scheduleVoiceReanalysis(
      db,
      { ...x.ctx, requestId: randomUUID() },
      x.session.id,
      dependencies,
      { operationKey },
    ),
  ).toBe(runId);
  const definition = voiceAnalysisJob(dependencies);
  for (let index = 0; index < 3; index++)
    await runFixtureProcessingStep(db, definition, { runId, userId: x.ctx.userId });
  expect((await getRun(db, x.ctx, runId)).state).toBe("ready");
  expect(await voiceProcessingStatus(db, x.ctx, x.session.id)).toBe(false);
  expect(
    await scheduleVoiceReanalysis(
      db,
      { ...x.ctx, requestId: randomUUID() },
      x.session.id,
      dependencies,
      { operationKey },
    ),
  ).toBe(runId);
  expect(x.provider.calls).toHaveBeenCalledTimes(1);
});

it("fails a legacy queued voice request without a language snapshot before private inference or correction billing", async () => {
  const x = await fixture(false, { labelledTranscript: true });
  await x.step();
  await enableVoice(db, x.ctx, VOICE_CONSENT_VERSION);
  const dependencies = { provider: x.provider, diarize: x.diarize };
  const runId = await scheduleVoiceReanalysis(db, x.ctx, x.session.id, dependencies, {
    operationKey: randomUUID(),
  });
  fixtureRunIds.push(runId);
  const row = await db
    .selectFrom("proc.processing_run")
    .select("settings")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  const legacy = { ...(row.settings as Record<string, unknown>) };
  delete legacy.explanationLanguage;
  await db
    .updateTable("proc.processing_run")
    .set({ settings: JSON.stringify(legacy) })
    .where("id", "=", runId)
    .execute();
  await runFixtureProcessingStep(db, voiceAnalysisJob(dependencies), {
    runId,
    userId: x.ctx.userId,
  });
  expect((await getRun(db, x.ctx, runId)).state).toBe("failed");
  expect(x.diarize).not.toHaveBeenCalled();
  expect(x.provider.calls).not.toHaveBeenCalled();
  expect(
    await db.selectFrom("proc.provider_attempt").select("id").where("run_id", "=", runId).execute(),
  ).toEqual([]);
});
