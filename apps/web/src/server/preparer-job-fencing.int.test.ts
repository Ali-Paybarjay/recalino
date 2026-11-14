// P11-02 AC-19 and AC-20 (ADR-0004 rule 4): the audio and PDF preparers of a processing job write
// object records only with that job's authority. A really claimed job and a real lease are used;
// no test-only mark (AC-16). A worker whose claim was taken by a reclaim neither creates nor
// verifies a plt.storage_object row through either preparer.
import { createHash, randomUUID } from "node:crypto";
import type { AiProvider, ProviderSettings } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import {
  cancelJob,
  claimJobs,
  DEFAULT_PLT_SETTINGS,
  enqueueJob,
  type JobContext,
  MemoryObjectStore,
  sweepJobs,
  writeOwnedObject,
} from "@recalino/core/plt";
import {
  cancelRun,
  createProcessingRun,
  processingJob,
  type RunSource,
  sourceSnapshotSchema,
} from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { selectSourceSnapshot } from "@recalino/core/src";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { prepareAudio } from "./audio-preparer";
import { preparePdfPages } from "./pdf-preparer";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());

const leaseLost = { name: "JobLeaseLost" };
type JobLease = NonNullable<JobContext["lease"]>;

/** A one-page blank PDF; its page renders to a small white image. */
function blankPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Two seconds of a 16 kHz mono tone. */
function syntheticWav(seconds: number): Buffer {
  const samples = 16000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    bytes.writeInt16LE(
      Math.round(Math.sin((index * Math.PI * 880) / 16000) * 2000),
      44 + index * 2,
    );
  return bytes;
}

const settings: ProviderSettings = {
  version: "synthetic-fencing",
  llmModel: "synthetic",
  visionModel: "synthetic",
  sttModel: "synthetic",
  ttsModel: "synthetic",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const provider: AiProvider = {
  name: "synthetic-fencing",
  mode: "mock",
  settings,
  async structured() {
    throw new Error("No live provider used");
  },
  async transcribe() {
    throw new Error("No live provider used");
  },
  async speech() {
    throw new Error("No live provider used");
  },
};

/**
 * A job of its own queue kind, claimed by worker A, and `reclaim`: A's lease ends on the database
 * clock, the sweep returns the job and worker B claims it, so A's claim is void (ADR-0004 rule 2).
 */
async function claimedJob() {
  const kind = `plt.synthetic_${randomUUID().replaceAll("-", "")}`;
  await db
    .transaction()
    .execute((tx) =>
      enqueueJob(
        tx,
        { kind, version: 1, payload: z.strictObject({}) },
        { payload: {}, now: new Date(), defaults: DEFAULT_PLT_SETTINGS.jobs },
      ),
    );
  const leaseOf = async (): Promise<JobLease> => {
    const [claim] = await claimJobs(db, [kind], 1, new Date());
    if (!claim || claim.generation === undefined) throw new Error("Expected a claim");
    return { id: claim.id, token: claim.token, generation: claim.generation };
  };
  const a = await leaseOf();
  let reclaimed = false;
  return {
    a,
    async reclaim(): Promise<void> {
      if (reclaimed) return;
      reclaimed = true;
      await db
        .updateTable("plt.job")
        .set({ lease_until: sql<Date>`now() - interval '1 minute'` })
        .where("id", "=", a.id)
        .execute();
      await sweepJobs(db, new Date());
      const b = await leaseOf();
      expect(b.id).toBe(a.id);
      expect(b.token).not.toBe(a.token);
    },
    done: () => cancelJob(db, a.id, new Date()),
  };
}

/** A learner with a processing run over a selected one-page PDF, and an owned verified WAV. */
async function preparedRun() {
  const f = await studyFixture(db);
  const store = new MemoryObjectStore();
  await grantEntitlement(db, {
    userId: f.ctx.userId,
    startsAt: new Date(f.now.getTime() - 1000),
    endsAt: new Date(f.now.getTime() + 3600000),
    amounts: amounts({ document: 10, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "synthetic-fencing-test",
    reason: "Synthetic preparer fencing",
  });
  const pdf = blankPdf();
  const pdfObjectId = await writeOwnedObject(db, store, f.ctx, {
    module: "src",
    retention: "durable",
    contentType: "application/pdf",
    bytes: pdf,
    now: f.now,
  });
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: f.ctx.userId,
      kind: "pdf",
      declared_mime: "application/pdf",
      verified_mime: "application/pdf",
      size_bytes: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      display_name: "Synthetic blank.pdf",
      contract_version: "1",
      retention: "persistent",
      page_count: 1,
      original_object_id: pdfObjectId,
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: f.now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: f.ctx.userId,
      session_id: f.session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
      ranges: JSON.stringify([]),
    })
    .execute();
  const snapshot = sourceSnapshotSchema.parse(await selectSourceSnapshot(db, f.ctx, f.session.id));
  const pdfSource = snapshot.sources[0];
  if (!pdfSource) throw new Error("Expected selected source");
  const run = await createProcessingRun(
    db,
    f.ctx,
    { sessionId: f.session.id, operationKey: randomUUID() },
    { provider, job: processingJob({ provider, store, preparePdfPages }) },
  );
  const wav = syntheticWav(2);
  const wavObjectId = await writeOwnedObject(db, store, f.ctx, {
    module: "src",
    retention: "durable",
    contentType: "audio/wav",
    bytes: wav,
    now: f.now,
  });
  const audioSource: RunSource = {
    sourceId: randomUUID(),
    kind: "audio",
    sha256: createHash("sha256").update(wav).digest("hex"),
    mimeType: "audio/wav",
    durationMs: 2000,
    pageCount: null,
    objectId: wavObjectId,
    contentVersionId: null,
    captureAnchor: null,
    ranges: [],
    units: [],
    blocks: [],
  };
  const originals = new Set([pdfObjectId, wavObjectId]);
  const preparedObjects = async () =>
    (
      await db
        .selectFrom("plt.storage_object")
        .select(["id", "state"])
        .where("owner_user_id", "=", f.ctx.userId)
        .execute()
    ).filter((row) => !originals.has(row.id));
  return { f, store, run, pdfSource, audioSource, preparedObjects };
}

/** A store whose next bytes write is followed by the job's reclaim, before the verification. */
function reclaimingDuringWrite(store: MemoryObjectStore, reclaim: () => Promise<void>) {
  return Object.assign(Object.create(store) as MemoryObjectStore, {
    write: async (key: string, bytes: Uint8Array, contentType: string) => {
      await store.write(key, bytes, contentType);
      await reclaim();
    },
  });
}

describe("P11-02 AC-20 preparers inside a processing job write object records only with its authority", () => {
  it("a stale worker's audio preparer, after the reclaim, creates no object row", async () => {
    const { f, store, run, audioSource, preparedObjects } = await preparedRun();
    const job = await claimedJob();
    await job.reclaim();
    await expect(
      prepareAudio({
        db,
        store,
        ctx: f.ctx,
        runId: run.id,
        source: audioSource,
        now: f.now,
        job: { lease: job.a },
      }),
    ).rejects.toMatchObject(leaseLost);
    expect(await preparedObjects()).toEqual([]);
    await cancelRun(db, f.ctx, run.id);
    await job.done();
  }, 60000);

  it("an audio preparer whose claim becomes void while it writes bytes never verifies the row", async () => {
    const { f, store, run, audioSource, preparedObjects } = await preparedRun();
    const job = await claimedJob();
    await expect(
      prepareAudio({
        db,
        store: reclaimingDuringWrite(store, job.reclaim),
        ctx: f.ctx,
        runId: run.id,
        source: audioSource,
        now: f.now,
        job: { lease: job.a },
      }),
    ).rejects.toMatchObject(leaseLost);
    const rows = await preparedObjects();
    expect(rows.some((row) => row.state === "verified")).toBe(false);
    // AC-21: without authority the stale worker leaves its pending row alone (D2).
    expect(rows.every((row) => row.state === "pending")).toBe(true);
    await cancelRun(db, f.ctx, run.id);
    await job.done();
  }, 60000);

  it("a stale worker's PDF preparer, after the reclaim, creates no object row", async () => {
    const { f, store, run, pdfSource, preparedObjects } = await preparedRun();
    const job = await claimedJob();
    await job.reclaim();
    await expect(
      preparePdfPages({
        db,
        store,
        ctx: f.ctx,
        runId: run.id,
        source: pdfSource,
        pages: [1],
        now: f.now,
        job: { lease: job.a },
      }),
    ).rejects.toMatchObject(leaseLost);
    expect(await preparedObjects()).toEqual([]);
    await cancelRun(db, f.ctx, run.id);
    await job.done();
  }, 60000);

  it("a PDF preparer whose claim becomes void while it writes bytes never verifies the row", async () => {
    const { f, store, run, pdfSource, preparedObjects } = await preparedRun();
    const job = await claimedJob();
    await expect(
      preparePdfPages({
        db,
        store: reclaimingDuringWrite(store, job.reclaim),
        ctx: f.ctx,
        runId: run.id,
        source: pdfSource,
        pages: [1],
        now: f.now,
        job: { lease: job.a },
      }),
    ).rejects.toMatchObject(leaseLost);
    const rows = await preparedObjects();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("pending");
    await cancelRun(db, f.ctx, run.id);
    await job.done();
  }, 60000);

  it("with its current claim, the PDF preparer creates and verifies the row as before", async () => {
    const { f, store, run, pdfSource, preparedObjects } = await preparedRun();
    const job = await claimedJob();
    const images = await preparePdfPages({
      db,
      store,
      ctx: f.ctx,
      runId: run.id,
      source: pdfSource,
      pages: [1],
      now: f.now,
      job: { lease: job.a },
    });
    expect(images.map((image) => image.page)).toEqual([1]);
    expect(await preparedObjects()).toEqual([{ id: images[0]?.objectId, state: "verified" }]);
    await cancelRun(db, f.ctx, run.id);
    await job.done();
  }, 60000);
});
