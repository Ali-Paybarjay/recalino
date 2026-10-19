import { vi } from "vitest";
import type { AiProvider, ProviderSettings } from "../src/aip";
import type { Database, Tx } from "../src/db";
import type { JobContext } from "../src/plt";
import type { RunSource } from "../src/proc";
import type { ProcessingRun } from "../src/proc/steps/context";
import { visionContract } from "../src/proc/steps/vision";

// Synthetic fixtures for unit tests of the processing stages (audit QUA-01): no database, no
// network. A stage's checkpoint helpers are mocked per test; `job.db` only records writes.

export const RUN_ID = "33333333-3333-4333-8333-333333333333";
export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const SESSION_ID = "22222222-2222-4222-8222-222222222222";
export const NOW = new Date("2026-10-19T10:00:00.000Z");

let sourceNumber = 0;
/** A snapshot source; `kind` decides which extraction stage reads it. */
export function runSource(overrides: Partial<RunSource> = {}): RunSource {
  sourceNumber += 1;
  return {
    sourceId: `44444444-4444-4444-8444-${String(sourceNumber).padStart(12, "0")}`,
    kind: "text",
    sha256: "a".repeat(64),
    mimeType: "text/plain",
    durationMs: null,
    pageCount: null,
    objectId: null,
    contentVersionId: "55555555-5555-4555-8555-555555555555",
    captureAnchor: null,
    ranges: [],
    units: [{ id: "doc", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "doc-1", kind: "paragraph", text: "Synthetic class text.", unitId: "doc" }],
    ...overrides,
  };
}

export function providerSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    version: "synthetic-1",
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "synthetic-prompt",
    maxInputCharacters: 100_000,
    maxOutputTokens: 6144,
    timeoutMs: 60_000,
    maximumMicros: 1_000_000,
    currency: "USD",
    priceVersion: "synthetic-price",
    charactersPerPage: 1800,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
    ...overrides,
  };
}

/** A mock provider; every call must be stubbed by the test that expects it. */
export function mockProvider(settings = providerSettings()): AiProvider {
  return {
    name: "synthetic",
    mode: "mock",
    settings,
    structured: vi.fn(async () => {
      throw new Error("unexpected structured call");
    }),
    transcribe: vi.fn(async () => {
      throw new Error("unexpected transcription");
    }),
    speech: vi.fn(async () => {
      throw new Error("unexpected speech");
    }),
  };
}

/** A query builder stand-in that records each chained call; `execute*` resolves to `rows`. */
export function recordingTx(calls: unknown[][], rows: unknown[] = []): Tx {
  const chain: unknown = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) => {
          calls.push([String(name), ...args]);
          return String(name).startsWith("execute") ? Promise.resolve(rows) : chain;
        },
    },
  );
  return chain as Tx;
}

export function syntheticJob(calls: unknown[][] = [], deadline?: Date): JobContext {
  const db = {
    transaction: () => ({
      execute: async <T>(work: (tx: Tx) => Promise<T>) => work(recordingTx(calls)),
    }),
  } as unknown as Database;
  return {
    db,
    now: () => NOW,
    job: { id: "synthetic-job", attempt: 1 },
    ...(deadline ? { deadline } : {}),
    step: vi.fn(),
  } as unknown as JobContext;
}

export function stageRun(overrides: Partial<ProcessingRun> = {}): ProcessingRun {
  const provider = overrides.provider ?? mockProvider();
  const settings = overrides.settings ?? {
    provider: provider.settings,
    explanationLanguage: "fa",
    profileVersion: 1,
    teachingPreferences: { shorterExamples: false },
  };
  return {
    job: syntheticJob(),
    ctx: { userId: USER_ID, requestId: "synthetic-job" },
    payload: { runId: RUN_ID, userId: USER_ID },
    definition: { kind: "proc.process", version: 1 } as ProcessingRun["definition"],
    dependencies: { store: {} as ProcessingRun["dependencies"]["store"], provider },
    provider,
    initial: { id: RUN_ID, session_id: SESSION_ID } as ProcessingRun["initial"],
    settings,
    snapshot: { sourcesVersion: 1, fingerprint: "synthetic", sources: [runSource()] },
    vision: visionContract(settings.provider.lessonQuality),
    ...overrides,
  };
}
