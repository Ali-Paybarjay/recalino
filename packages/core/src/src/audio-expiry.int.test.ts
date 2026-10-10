import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import { LOCAL_ADMIN_DATABASE_URL, LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import { createDatabase } from "../db";
import { createSession } from "../org";
import {
  DEFAULT_PLT_SETTINGS,
  ensurePeriodicJob,
  MemoryObjectStore,
  runDueJobs,
  sha256Hex,
} from "../plt";
import { amounts, grantEntitlement, reserveAllowance } from "../quota";
import {
  beginTemporaryAudioUpload,
  liveTemporaryAudioObject,
  markSourceAudioTranscribed,
  TEMPORARY_AUDIO_SWEEP_SECONDS,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "./audio";
import { readInputContract } from "./contracts";
import { sourcePeriodicJobs } from "./jobs";
import { acceptSourceNotice, createSource } from "./service";

// FR-SRC-007 rule 6 (D29) through the job queue, run as the cron runs it every minute. Deletion
// sweeps are global, so this file has a database of its own: no other test's audio is in reach.
const databaseName = `recalino_audio_expiry_${randomUUID().replaceAll("-", "")}`;

function isolatedUrl(value: string): string {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Invalid isolated test database configuration");
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const provision = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
const admin = createDatabase(isolatedUrl(LOCAL_ADMIN_DATABASE_URL), { maxConnections: 1 });
const db = createDatabase(isolatedUrl(LOCAL_APP_DATABASE_URL), { maxConnections: 2 });
let created = false;

beforeAll(async () => {
  await sql`create database ${sql.id(databaseName)} template template0`.execute(provision);
  created = true;
  // App migrations reference only Auth user ids.
  await sql`create schema auth`.execute(admin);
  await sql`create table auth.users (id uuid primary key)`.execute(admin);
  const directory = new URL("../../../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort())
    await sql.raw(await readFile(new URL(name, directory), "utf8")).execute(admin);
}, 120_000);
afterAll(async () => {
  try {
    await db.destroy();
    await admin.destroy();
  } finally {
    try {
      if (created) await sql`drop database ${sql.id(databaseName)}`.execute(provision);
    } finally {
      await provision.destroy();
    }
  }
});

/** A class recording uploaded at hh:24:05 and transcribed at hh:31:34 of the given hour. */
async function transcribedRecording(hour: number) {
  const userId = randomUUID();
  await sql`insert into auth.users (id) values (${userId})`.execute(admin);
  const ctx = { userId, requestId: randomUUID() };
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(db, ctx, change, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const session = await createSession(db, ctx, {}, { key: randomUUID(), now });
  await acceptSourceNotice(db, ctx, (await readInputContract(db)).noticeVersion, true);
  await grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600_000),
    amounts: amounts({ audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic temporary audio expiry",
  });
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const source = await createSource(db, ctx, {
    sessionId: session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic.mp3",
    durationMs: 4000,
    parts: [],
    operationKey: randomUUID(),
  });
  const hold = await db
    .transaction()
    .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 4 })));
  const uploadedAt = new Date(hour + (24 * 60 + 5) * 1000);
  const upload = await beginTemporaryAudioUpload(
    db,
    ctx,
    source.assetId,
    {
      reservationId: hold.id,
      parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
    },
    uploadedAt,
  );
  const store = new MemoryObjectStore();
  const link = await temporaryAudioPartLink(
    db,
    store,
    ctx,
    source.assetId,
    upload.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "audio/mpeg")).toBe(200);
  await verifyTemporaryAudio(
    db,
    store,
    ctx,
    source.assetId,
    upload.uploadId,
    { inspect: async () => ({ durationMs: 3200, audioOnly: true }) },
    new Date(uploadedAt.getTime() + 60_000),
  );
  const transcribedAt = new Date(hour + (31 * 60 + 34) * 1000);
  await markSourceAudioTranscribed(db, ctx, source.assetId, transcribedAt);
  return { ctx, store, assetId: source.assetId, uploadId: upload.uploadId, transcribedAt };
}

it("FR-SRC-007 deletes transcribed class audio within 24 hours, between hourly maintenance runs (D29)", async () => {
  // The production case of 2026-10-10: uploaded at 01:24:05, transcribed at 01:31:34 UTC.
  const hour = Math.ceil(Date.now() / 3600_000) * 3600_000;
  const x = await transcribedRecording(hour);
  const limit = x.transcribedAt.getTime() + 24 * 3600_000;
  const upload = () =>
    db
      .selectFrom("src.audio_upload")
      .select(["object_id", "state", "expires_at", "deleted_at"])
      .where("id", "=", x.uploadId)
      .executeTakeFirstOrThrow();
  const { object_id: objectId, expires_at: expiresAt } = await upload();
  const jobs = sourcePeriodicJobs(x.store);
  const definitions = jobs.map((job) => job.definition);
  // Every cron minute from the top of the hour, so the hourly maintenance has run before expiry.
  for (let at = hour + 24 * 3600_000; at <= limit; at += 60_000) {
    const now = new Date(at);
    for (const job of jobs)
      await ensurePeriodicJob(db, job.definition, job.everySeconds, now, DEFAULT_PLT_SETTINGS.jobs);
    expect(
      await runDueJobs(db, definitions, { deadline: new Date(at + 60_000), now: () => now }),
    ).toMatchObject({ failed: 0, retried: 0 });
    // A voice check may use the copy exactly until it expires, and no sweep deletes it before.
    expect(await liveTemporaryAudioObject(db, x.ctx, x.assetId, objectId, now)).toBe(
      at < expiresAt.getTime(),
    );
    if (at < expiresAt.getTime()) expect((await upload()).state).toBe("verified");
  }
  const { state, deleted_at: deletedAt } = await upload();
  expect(state).toBe("deleted");
  if (!deletedAt) throw new Error("Deletion time missing");
  expect(deletedAt.getTime()).toBeLessThanOrEqual(limit);
  expect(deletedAt.getTime() - expiresAt.getTime()).toBeLessThanOrEqual(
    TEMPORARY_AUDIO_SWEEP_SECONDS * 1000,
  );
  expect(deletedAt.getUTCMinutes()).not.toBe(0);
  expect((await x.store.list("")).objects).toEqual([]);
});
