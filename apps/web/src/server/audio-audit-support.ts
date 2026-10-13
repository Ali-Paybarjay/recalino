import { randomUUID } from "node:crypto";
import { OpenRouterProvider, type ProviderSettings } from "@recalino/core/aip";
import type { Database } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { type JobContext, sha256Hex } from "@recalino/core/plt";
import { createProcessingRun, getRun } from "@recalino/core/proc";
import { amounts, configureCostPolicy, grantEntitlement } from "@recalino/core/quota";
import { acceptSourceNotice, createSource, readInputContract } from "@recalino/core/src";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import type { Recording } from "../ui/recording/store";
import { defineRoute } from "./api";
import { automaticLearningHandler } from "./automatic-learning-routes";
import { classProcessingHandler, processingRunHandler } from "./processing-routes";
import { ROUTES } from "./routes";
import { classSourcesHandler, sourceAudioHandler, sourceContractHandler } from "./source-routes";
import { routeDeps } from "./test-support";

/**
 * Second audit of workstream 1 (2026-10-13): the browser client (`workspaceRequest`,
 * `uploadAutomaticAudio`, `ManualAudioManager`) runs against the real route handlers through a
 * stubbed `fetch`. Only the file store, the AI provider and the audio decoder are synthetic.
 */
export const auditProviderSettings: ProviderSettings = {
  version: "synthetic-audit",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 100,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const transcript = "We practised the present perfect with synthetic sentences.";

/** Synthetic STT and lesson answers; no network request leaves the test. */
export function auditProvider() {
  const request = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/audio/transcriptions"))
      return new Response(
        JSON.stringify({
          text: transcript,
          language: "en",
          segments: [{ start: 0, end: 2, text: transcript }],
          usage: { seconds: 2, cost: 0.000002 },
        }),
        { headers: { "X-Generation-Id": `synthetic-audit-stt-${randomUUID()}` } },
      );
    const body = JSON.parse(String(init?.body));
    const source = JSON.parse(body.messages[1].content[0].text).sources[0];
    return new Response(
      JSON.stringify({
        id: `synthetic-audit-lesson-${randomUUID()}`,
        model: auditProviderSettings.llmModel,
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                schemaVersion: "1",
                title: "Present perfect",
                language: { learning: "en", explanation: "en" },
                summary: [
                  {
                    id: "synthetic-summary",
                    text: "We practised the present perfect.",
                    origin: "from_class",
                    creation: "ai_generation",
                    evidence: "audio",
                    sourceRefs: [source.allowedSourceRefs[0]],
                    speakerRole: "unknown",
                    uncertain: false,
                  },
                ],
                topics: [],
                learningItems: [],
                homework: [],
                uncertainties: [],
                coverage: { complete: true, missingSourceIds: [] },
                sourceClassifications: [
                  {
                    sourceId: source.sourceId,
                    classification: { role: "class_material", confidence: "high" },
                  },
                ],
              }),
            },
          },
        ],
        usage: { cost: 0.000003 },
      }),
    );
  };
  return new OpenRouterProvider("synthetic-private-key", auditProviderSettings, request);
}

/** A learner with an accepted source notice, an audio allowance and a cost policy. */
export async function auditLearner(db: Database, audioSeconds = 40) {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: audioSeconds, regeneration: 6 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Second audit of upload reliability",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-audit",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic", reason: "Second audit of upload reliability" },
  );
  return { ctx: x.ctx, userId: x.ctx.userId, session: x.session };
}

/** Synthetic audio bytes of a given size: an ID3 header, then zeros. */
export function auditAudio(sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x49, 0x44, 0x33]);
  return bytes;
}

export async function auditClass(db: Database, ctx: { userId: string; requestId: string }) {
  return createSession(db, ctx, { title: "Synthetic audit class" }, { key: randomUUID() });
}

/** A device-only audio source of the class whose bytes stay on the device (D29). */
export async function auditSource(
  db: Database,
  ctx: { userId: string; requestId: string },
  sessionId: string,
  bytes: Uint8Array,
  durationMs = 4000,
) {
  return createSource(db, ctx, {
    sessionId,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "synthetic-audit.mp3",
    durationMs,
    parts: [],
    operationKey: randomUUID(),
  });
}

/** The recordings the device holds for `uploadAutomaticAudio`: one saved original per source. */
export function auditRecordings(
  userId: string,
  sessionId: string,
  originals: { sourceId: string; bytes: Uint8Array }[],
) {
  const now = new Date().toISOString();
  const rows: Recording[] = originals.map((original) => ({
    id: randomUUID(),
    userId,
    sessionId,
    sourceAssetId: original.sourceId,
    creationKey: randomUUID(),
    status: "saved",
    mimeType: "audio/mpeg",
    activeMs: 4000,
    bytes: original.bytes.length,
    chunks: 1,
    createdAt: now,
    updatedAt: now,
  }));
  const blobs = new Map(
    rows.map((row, index) => {
      const source = originals[index]?.bytes ?? new Uint8Array();
      const copy = new Uint8Array(new ArrayBuffer(source.byteLength));
      copy.set(source);
      return [row.id, new Blob([copy], { type: "audio/mpeg" })];
    }),
  );
  return {
    rows,
    list: async (owner: string) => rows.filter((row) => row.userId === owner),
    blob: async (_owner: string, id: string) => {
      const blob = blobs.get(id);
      if (!blob) throw new Error("Recording is missing on this device");
      return blob;
    },
  };
}

/** The confirmed run the client needs before any audio leaves the device (D29 rule 2). */
export async function auditConfirmedRun(
  db: Database,
  ctx: { userId: string; requestId: string },
  sessionId: string,
  options: Parameters<typeof createProcessingRun>[3],
) {
  const run = await createProcessingRun(
    db,
    ctx,
    { sessionId, operationKey: randomUUID() },
    options,
  );
  if (run.state !== "awaiting_upload")
    throw new Error(`Expected awaiting_upload, got ${run.state}`);
  return run;
}

export async function auditContract(db: Database) {
  return readInputContract(db);
}

/**
 * `fetch` for the browser client: every request goes through `defineRoute`, so authentication,
 * same-origin checks, body parsing and error responses are the production ones.
 */
export function auditFetch(db: Database, user: () => string | null): typeof fetch {
  const deps = routeDeps(db);
  const routes: {
    pattern: RegExp;
    route: (id: string) => (request: Request) => Promise<Response>;
  }[] = [
    {
      pattern: /^\/api\/sources\/contract$/,
      route: () => defineRoute(ROUTES.sourceContract, sourceContractHandler(), deps),
    },
    {
      pattern: /^\/api\/sources\/([0-9a-f-]{36})\/audio(?:\?|$)/,
      route: (id) => defineRoute(ROUTES.sourceAudio, sourceAudioHandler(id), deps),
    },
    {
      pattern: /^\/api\/runs\/([0-9a-f-]{36})(?:\?|$)/,
      route: (id) => defineRoute(ROUTES.processingRun, processingRunHandler(id), deps),
    },
    {
      pattern: /^\/api\/classes\/([0-9a-f-]{36})\/sources$/,
      route: (id) => defineRoute(ROUTES.classSources, classSourcesHandler(id), deps),
    },
    {
      pattern: /^\/api\/classes\/([0-9a-f-]{36})\/processing$/,
      route: (id) => defineRoute(ROUTES.classProcessing, classProcessingHandler(id), deps),
    },
    {
      pattern: /^\/api\/classes\/([0-9a-f-]{36})\/learning$/,
      route: (id) =>
        defineRoute(ROUTES.classLearning, automaticLearningHandler(id, { wake: () => {} }), deps),
    },
  ];
  return async (input, init) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const match = routes.find((candidate) => candidate.pattern.test(path));
    if (!match) throw new Error(`No audit route for ${path}`);
    const id = match.pattern.exec(path)?.[1] ?? "";
    const headers = new Headers(init?.headers);
    headers.set("sec-fetch-site", "same-origin");
    const userId = user();
    if (userId) headers.set("x-test-user", userId);
    return match.route(id)(
      new Request(`http://localhost:3000${path}`, {
        method: init?.method ?? "GET",
        headers,
        body: init?.body ?? undefined,
        signal: init?.signal ?? undefined,
      }),
    );
  };
}

export function auditJobContext(db: Database): JobContext {
  return {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  };
}

/** Drives one class run through the processing job until it leaves the active states. */
export async function auditProcess(
  db: Database,
  ctx: { userId: string; requestId: string },
  runId: string,
  run: (payload: { runId: string; userId: string }, context: JobContext) => Promise<void>,
) {
  for (let step = 0; step < 12; step++) {
    const current = await getRun(db, ctx, runId);
    if (!["queued", "processing"].includes(current.state)) return current;
    await run({ runId, userId: ctx.userId }, auditJobContext(db));
  }
  throw new Error("Synthetic run did not finish within its checkpoint limit");
}
