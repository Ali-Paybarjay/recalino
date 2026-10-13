import { createDatabase } from "@recalino/core/db";
import { MemoryObjectStore } from "@recalino/core/plt";
import { getRun } from "@recalino/core/proc";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { workspaceRequest } from "../ui/workspace/api";
import {
  AUDIO_PART_CONCURRENCY,
  type AutomaticUploadProgress,
  uploadAutomaticAudio,
} from "../ui/workspace/automatic-learning";
import {
  auditAudio,
  auditConfirmedRun,
  auditContract,
  auditFetch,
  auditLearner,
  auditProvider,
  auditRecordings,
  auditSource,
} from "./audio-audit-support";
import { getProcessingDefinition } from "./processing-jobs";

/**
 * Second audit (2026-10-13), item 5: transfer timing against the real routes and tables. The
 * PUT lands in the designated test store, so the numbers cover hashing, the route round trips,
 * part bookkeeping and the client pipeline, not the network. Default sizes keep CI quick;
 * RECALINO_MEASURE=1 uses the 128-minute shape: six 8 MiB parts (48 MiB).
 */
const synthetic = vi.hoisted(() => ({
  store: null as MemoryObjectStore | null,
  provider: null as unknown,
  puts: 0,
  inFlight: 0,
  peak: 0,
  beforePut: null as null | ((url: string) => Promise<void>),
}));
vi.mock("./storage", () => ({ getObjectStore: () => synthetic.store }));
vi.mock("./jobs", () => ({
  PROCESSING_WAKE: { budgetSeconds: 600, functionSeconds: 800 },
  runJobsSoon: () => {},
}));
vi.mock("./ai", () => ({ getAiProvider: () => synthetic.provider }));
vi.mock("../ui/workspace/upload-progress", () => ({
  uploadWithProgress: async (
    url: string,
    body: Blob,
    contentType: string,
    onProgress: (sent: number, total: number) => void,
  ) => {
    synthetic.inFlight++;
    synthetic.peak = Math.max(synthetic.peak, synthetic.inFlight);
    try {
      await synthetic.beforePut?.(url);
      synthetic.puts++;
      const bytes = new Uint8Array(await body.arrayBuffer());
      const status = synthetic.store?.upload(url, bytes, contentType) ?? 503;
      if (status === 200) onProgress(bytes.length, bytes.length);
      return { ok: status === 200, status };
    } finally {
      synthetic.inFlight--;
    }
  },
}));

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());
let currentUser: string | null = null;
beforeEach(() => {
  synthetic.store = new MemoryObjectStore();
  synthetic.provider = auditProvider();
  synthetic.puts = 0;
  synthetic.inFlight = 0;
  synthetic.peak = 0;
  synthetic.beforePut = null;
  vi.stubGlobal(
    "fetch",
    auditFetch(db, () => currentUser),
  );
});
afterEach(() => vi.unstubAllGlobals());
const measure = process.env.RECALINO_MEASURE === "1";
const MiB = 1024 * 1024;

async function fixture(sizes: number[]) {
  const learner = await auditLearner(db, 100000);
  currentUser = learner.userId;
  const processing = getProcessingDefinition();
  if (!processing) throw new Error("processing unavailable");
  const originals = [];
  for (const size of sizes) {
    const bytes = auditAudio(size);
    const source = await auditSource(db, learner.ctx, learner.session.id, bytes, 128 * 60_000);
    originals.push({ sourceId: source.assetId, bytes });
  }
  const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
    provider: auditProvider(),
    job: processing,
  });
  const read = await workspaceRequest<{
    run: Parameters<typeof uploadAutomaticAudio>[0];
    snapshot: Parameters<typeof uploadAutomaticAudio>[1];
  }>(`/api/runs/${run.id}?includeSnapshot=1`, "GET");
  return {
    learner,
    run,
    read,
    originals,
    contract: await auditContract(db),
    store: auditRecordings(learner.userId, learner.session.id, originals),
  };
}
function report(name: string, values: Record<string, number | string>) {
  process.stdout.write(`[audit 5] ${name} ${JSON.stringify(values)}\n`);
}

it("measures run creation → upload start, side-by-side files versus the old one-after-another transfer, and the part cap", async () => {
  const contract = await auditContract(db);
  const parts = measure ? 6 : 2;
  const perFile = contract.partBytes; // one 8 MiB part per file, as in-app capture produces
  const sizes = Array.from({ length: parts }, () => perFile);
  const parallel = await fixture(sizes);
  const startedAt = Date.now();
  const progress: AutomaticUploadProgress[] = [];
  await uploadAutomaticAudio(parallel.read.run, parallel.read.snapshot, parallel.contract, {
    userId: parallel.learner.userId,
    store: parallel.store,
    onTransferProgress: (value) => progress.push(value),
  });
  const parallelMs = Date.now() - startedAt;
  const firstUpload = await db
    .selectFrom("src.audio_upload")
    .select("created_at")
    .where("reservation_id", "=", parallel.run.reservationId)
    .orderBy("created_at")
    .executeTakeFirstOrThrow();
  const runCreated = (await getRun(db, parallel.learner.ctx, parallel.run.id)).createdAt;
  const startLatencyMs = firstUpload.created_at.getTime() - new Date(runCreated).getTime();
  expect(synthetic.puts).toBe(parts);
  expect(synthetic.peak).toBeLessThanOrEqual(AUDIO_PART_CONCURRENCY);
  expect(progress.at(-1)?.files.every((file) => file.phase === "verifying")).toBe(true);
  // The pre-2026-10-12 transfer: one source after another, each with its own call.
  const sequential = await fixture(sizes);
  synthetic.puts = 0;
  const sequentialStart = Date.now();
  for (const source of sequential.read.snapshot.sources)
    await uploadAutomaticAudio(
      sequential.read.run,
      { ...sequential.read.snapshot, sources: [source] },
      sequential.contract,
      { userId: sequential.learner.userId, store: sequential.store },
    );
  const sequentialMs = Date.now() - sequentialStart;
  expect(synthetic.puts).toBe(parts);
  report("transfer", {
    files: parts,
    bytesPerFile: perFile,
    totalMiB: Math.round((parts * perFile) / MiB),
    startLatencyMs,
    parallelMs,
    sequentialMs,
    peakSimultaneousParts: synthetic.peak,
  });
  // The confirmed run's first upload row follows the run within the start window.
  expect(startLatencyMs).toBeLessThan(6000);
});

it("resumes after a transfer killed mid-part: same upload, the killed part once more, no duplicate rows", async () => {
  const contract = await auditContract(db);
  const parts = measure ? 6 : 2;
  const x = await fixture([contract.partBytes * (parts - 1) + 3]);
  const abort = new AbortController();
  let killed = false;
  synthetic.beforePut = async () => {
    if (!killed) {
      killed = true;
      abort.abort(new DOMException("Connection lost", "AbortError"));
    }
  };
  const first = await uploadAutomaticAudio(x.read.run, x.read.snapshot, x.contract, {
    userId: x.learner.userId,
    store: x.store,
    signal: abort.signal,
  }).catch((error: unknown) => error);
  expect(first).toBeInstanceOf(DOMException);
  const rowsAfterKill = await db
    .selectFrom("src.audio_upload")
    .select("id")
    .where("reservation_id", "=", x.run.reservationId)
    .execute();
  expect(rowsAfterKill).toHaveLength(1);
  synthetic.beforePut = null;
  const resumedPutsBefore = synthetic.puts;
  const resumeStart = Date.now();
  await uploadAutomaticAudio(x.read.run, x.read.snapshot, x.contract, {
    userId: x.learner.userId,
    store: x.store,
  });
  const resumeMs = Date.now() - resumeStart;
  const rows = await db
    .selectFrom("src.audio_upload")
    .select("id")
    .where("reservation_id", "=", x.run.reservationId)
    .execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toBe(rowsAfterKill[0]?.id);
  const storedParts = await db
    .selectFrom("src.audio_upload_part")
    .select(["part_index", "verified_at"])
    .where("upload_id", "=", rows[0]?.id ?? "")
    .orderBy("part_index")
    .execute();
  expect(storedParts).toHaveLength(parts);
  expect(storedParts.every((part) => part.verified_at !== null)).toBe(true);
  // Every part is sent exactly once in total; the killed attempt never reached the store.
  expect(synthetic.puts - resumedPutsBefore + resumedPutsBefore).toBe(parts);
  report("resume", {
    parts,
    resumeMs,
    putsBeforeKill: resumedPutsBefore,
    putsTotal: synthetic.puts,
  });
});
