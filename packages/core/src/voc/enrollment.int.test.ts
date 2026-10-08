import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { voiceFixture } from "../../test/voice-fixture";
import { createDatabase } from "../db";
import { MemoryObjectStore, readOwnedObject } from "../plt";
import { beginVoiceEnrollment, completeVoiceEnrollment, failVoiceEnrollment } from "./enrollment";
import {
  cleanupVoiceSampleObjects,
  getVoiceProfile,
  revokeVoiceData,
  saveVoiceSample,
} from "./profile";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const request = (expectedVersion: number) => ({
  key: randomUUID(),
  requestHash: "c".repeat(64),
  consentVersion: "voice-v1",
  expectedVersion,
});
function sample(profileVersion: number) {
  return {
    profileVersion,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: "synthetic-enrollment-v1",
    embedding: [1, ...Array<number>(15).fill(0)],
  };
}
class PausedWriteStore extends MemoryObjectStore {
  private releaseWrite: () => void = () => {};
  private signalStarted: () => void = () => {};
  readonly started = new Promise<void>((resolve) => {
    this.signalStarted = resolve;
  });
  private readonly waiting = new Promise<void>((resolve) => {
    this.releaseWrite = resolve;
  });
  release() {
    this.releaseWrite();
  }
  override async write(key: string, bytes: Uint8Array, contentType: string) {
    this.signalStarted();
    await this.waiting;
    await super.write(key, bytes, contentType);
  }
}

describe("voice enrollment receipts and cleanup", () => {
  it("replays a completed save without another sample and rejects simultaneous inference", async () => {
    const x = await voiceFixture(db),
      input = request(x.input.profileVersion),
      store = new MemoryObjectStore();
    const first = await beginVoiceEnrollment(db, x.ctx, input);
    if (first.completed) throw new Error("Expected a new enrollment claim");
    await expect(beginVoiceEnrollment(db, x.ctx, input)).rejects.toMatchObject({
      code: "conflict",
    });
    await saveVoiceSample(db, store, x.ctx, {
      ...sample(first.attempt.profileVersion),
      enrollmentAttempt: first.attempt,
    });
    expect(await beginVoiceEnrollment(db, x.ctx, input)).toMatchObject({ completed: true });
    expect(
      await db
        .selectFrom("voc.sample_object")
        .select("object_id")
        .where("user_id", "=", x.ctx.userId)
        .execute(),
    ).toHaveLength(1);
    const receipt = await db
      .selectFrom("voc.enrollment_request")
      .selectAll()
      .where("user_id", "=", x.ctx.userId)
      .executeTakeFirstOrThrow();
    expect(receipt).toMatchObject({
      state: "completed",
      attempt_id: null,
      request_hash: input.requestHash,
    });
    await expect(
      beginVoiceEnrollment(db, x.ctx, { ...input, requestHash: "d".repeat(64) }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps revoked key tombstones without sample hashes and never reenables an old retry", async () => {
    const x = await voiceFixture(db),
      input = request(x.input.profileVersion);
    const started = await beginVoiceEnrollment(db, x.ctx, input);
    if (started.completed) throw new Error("Expected enrollment claim");
    await completeVoiceEnrollment(db, x.ctx, started.attempt);
    await revokeVoiceData(db, x.ctx);
    const receipt = await db
      .selectFrom("voc.enrollment_request")
      .selectAll()
      .where("user_id", "=", x.ctx.userId)
      .executeTakeFirstOrThrow();
    expect(receipt).toMatchObject({ state: "revoked", request_hash: null, attempt_id: null });
    await expect(beginVoiceEnrollment(db, x.ctx, input)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect((await getVoiceProfile(db, x.ctx)).enabled).toBe(false);
    const current = await getVoiceProfile(db, x.ctx);
    await expect(
      beginVoiceEnrollment(db, x.ctx, { ...input, key: randomUUID() }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const explicit = await beginVoiceEnrollment(db, x.ctx, request(current.version ?? 0));
    expect(explicit.completed).toBe(false);
    await expect(beginVoiceEnrollment(db, x.ctx, input)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("allows known failed retries only in the same epoch and fences an expired worker", async () => {
    const x = await voiceFixture(db),
      input = request(x.input.profileVersion),
      now = new Date();
    const first = await beginVoiceEnrollment(db, x.ctx, input, now);
    if (first.completed) throw new Error("Expected enrollment claim");
    await failVoiceEnrollment(db, x.ctx, first.attempt, now);
    const retry = await beginVoiceEnrollment(db, x.ctx, input, now);
    if (retry.completed) throw new Error("Expected enrollment retry");
    expect(retry.attempt.attemptId).not.toBe(first.attempt.attemptId);
    await expect(completeVoiceEnrollment(db, x.ctx, first.attempt, now)).rejects.toMatchObject({
      code: "validation_failed",
    });
    const later = new Date(now.getTime() + 16 * 60_000);
    const recovered = await beginVoiceEnrollment(db, x.ctx, input, later);
    if (recovered.completed) throw new Error("Expected expired claim recovery");
    await expect(completeVoiceEnrollment(db, x.ctx, retry.attempt, later)).rejects.toMatchObject({
      code: "validation_failed",
    });
    await completeVoiceEnrollment(db, x.ctx, recovered.attempt, later);
  });

  it("keeps a young in-flight sample through concurrent cleanup and verifies its publication", async () => {
    const x = await voiceFixture(db),
      store = new PausedWriteStore(),
      now = new Date();
    const saved = saveVoiceSample(db, store, x.ctx, sample(x.input.profileVersion), now);
    await store.started;
    await cleanupVoiceSampleObjects(db, store, x.ctx, now);
    store.release();
    await saved;
    const profile = await db
      .selectFrom("voc.profile")
      .select("sample_object_id")
      .where("user_id", "=", x.ctx.userId)
      .executeTakeFirstOrThrow();
    expect(profile.sample_object_id).not.toBeNull();
    if (!profile.sample_object_id) throw new Error("Sample was not published");
    expect(await readOwnedObject(db, store, x.ctx, profile.sample_object_id)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("retirement blocks a stale upload from publishing even when bytes arrive after cleanup", async () => {
    const x = await voiceFixture(db),
      store = new PausedWriteStore(),
      now = new Date();
    const saved = saveVoiceSample(db, store, x.ctx, sample(x.input.profileVersion), now);
    const outcome = saved.then(
      () => "saved",
      () => "rejected",
    );
    await store.started;
    await cleanupVoiceSampleObjects(db, store, x.ctx, new Date(now.getTime() + 2 * 60 * 60_000));
    store.release();
    expect(await outcome).toBe("rejected");
    expect(
      (
        await db
          .selectFrom("voc.profile")
          .select("sample_object_id")
          .where("user_id", "=", x.ctx.userId)
          .executeTakeFirstOrThrow()
      ).sample_object_id,
    ).toBeNull();
    expect((await store.list(`voc/${x.ctx.userId}/`)).objects).toEqual([]);
  });

  it("revocation during upload prevents a late sample and receipt from publishing", async () => {
    const x = await voiceFixture(db),
      store = new PausedWriteStore();
    const started = await beginVoiceEnrollment(db, x.ctx, request(x.input.profileVersion));
    if (started.completed) throw new Error("Expected enrollment claim");
    const saved = saveVoiceSample(db, store, x.ctx, {
      ...sample(started.attempt.profileVersion),
      enrollmentAttempt: started.attempt,
    });
    const outcome = saved.then(
      () => "saved",
      () => "rejected",
    );
    await store.started;
    await revokeVoiceData(db, x.ctx);
    await cleanupVoiceSampleObjects(db, store, x.ctx);
    store.release();
    expect(await outcome).toBe("rejected");
    expect(await getVoiceProfile(db, x.ctx)).toMatchObject({ enabled: false, enrolled: false });
    expect((await store.list(`voc/${x.ctx.userId}/`)).objects).toEqual([]);
    await failVoiceEnrollment(db, x.ctx, started.attempt);
    expect(
      (
        await db
          .selectFrom("voc.enrollment_request")
          .select("state")
          .where("user_id", "=", x.ctx.userId)
          .executeTakeFirstOrThrow()
      ).state,
    ).toBe("revoked");
  });
});
