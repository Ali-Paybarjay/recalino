import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Database, type Tx } from "../db";
import { redactUserIdempotencyResponses, runIdempotent } from "./idempotency";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
const second = createDatabase(testDatabaseUrl(), { maxConnections: 2 });

afterAll(async () => {
  await Promise.all([db.destroy(), second.destroy()]);
});

/** The observable effect: one audit row per run, tagged with a unique subject id. */
async function effect(tx: Tx, subjectId: string) {
  await tx
    .insertInto("plt.audit_event")
    .values({
      actor_kind: "system",
      actor_id: "test",
      action: "idempotency_probe",
      subject_type: "probe",
      subject_id: subjectId,
    })
    .execute();
  return { status: 201, body: { created: subjectId, items: [1, 2] } };
}

async function effects(subjectId: string): Promise<number> {
  const row = await db
    .selectFrom("plt.audit_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("subject_id", "=", subjectId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

function request(overrides: Partial<Parameters<typeof runIdempotent>[1]> = {}) {
  return {
    userId: randomUUID(),
    key: `key-${randomUUID()}`,
    route: "probe",
    requestHash: "hash-a",
    ttlSeconds: 3600,
    ...overrides,
  };
}

describe("FR-PLT-004 idempotency", () => {
  it("revokes private cached responses without replaying effects and preserves other owners", async () => {
    const req = request();
    const other = request();
    const subject = randomUUID();
    await runIdempotent(db, req, async () => ({
      status: 200,
      body: { text: "Synthetic deleted content" },
    }));
    await runIdempotent(db, other, async () => ({
      status: 200,
      body: { text: "Other owner content" },
    }));
    await db.transaction().execute((tx) => redactUserIdempotencyResponses(tx, req.userId));
    await expect(runIdempotent(db, req, (tx) => effect(tx, subject))).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await effects(subject)).toBe(0);
    expect(
      await db
        .selectFrom("plt.idempotency_key")
        .select("response_body")
        .where("user_id", "=", req.userId)
        .executeTakeFirst(),
    ).toEqual({ response_body: null });
    expect(
      (
        await runIdempotent(db, other, () => {
          throw new Error("Must replay");
        })
      ).body,
    ).toEqual({ text: "Other owner content" });
  });
  it("runs once and replays the first response for the same key", async () => {
    const subject = randomUUID();
    const req = request();
    const first = await runIdempotent(db, req, (tx) => effect(tx, subject));
    const again = await runIdempotent(db, req, (tx) => effect(tx, subject));
    expect(first).toEqual({
      status: 201,
      body: { created: subject, items: [1, 2] },
      replayed: false,
    });
    expect(again).toEqual({ ...first, replayed: true });
    expect(await effects(subject)).toBe(1);
  });

  it("rejects the same key with a different body and has no effect", async () => {
    const subject = randomUUID();
    const req = request();
    await runIdempotent(db, req, (tx) => effect(tx, subject));
    await expect(
      runIdempotent(db, { ...req, requestHash: "hash-b" }, (tx) => effect(tx, `${subject}-b`)),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    expect(await effects(`${subject}-b`)).toBe(0);
  });

  it("applies exactly one effect for two concurrent requests with one key", async () => {
    const subject = randomUUID();
    const req = request();
    const slowEffect = async (tx: Tx) => {
      await sql`select pg_sleep(0.3)`.execute(tx);
      return effect(tx, subject);
    };
    const [a, b] = await Promise.all([
      runIdempotent(db, req, slowEffect),
      runIdempotent(second, req, slowEffect),
    ]);
    expect(await effects(subject)).toBe(1);
    expect(a.body).toEqual(b.body);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("lets a retry run when the first attempt rolled back", async () => {
    const subject = randomUUID();
    const req = request();
    await expect(
      runIdempotent(db, req, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const retry = await runIdempotent(db, req, (tx) => effect(tx, subject));
    expect(retry.replayed).toBe(false);
    expect(await effects(subject)).toBe(1);
  });

  it("scopes keys per user and runs again after the key expires", async () => {
    const subject = randomUUID();
    const req = request({ ttlSeconds: 60, now: new Date("2026-10-01T09:00:00Z") });
    await runIdempotent(db, req, (tx) => effect(tx, subject));
    await runIdempotent(db, { ...req, userId: randomUUID() }, (tx) => effect(tx, subject));
    await runIdempotent(db, { ...req, now: new Date("2026-10-01T09:02:00Z") }, (tx) =>
      effect(tx, subject),
    );
    expect(await effects(subject)).toBe(3);
  });
});

export type { Database };
