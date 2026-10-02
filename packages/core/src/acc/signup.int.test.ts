import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { getAccountState } from "./account";
import { CURRENT_VERSIONS } from "./documents";
import { completeSignIn, createSignupIntent, purgeExpiredSignupIntents } from "./signup";

// FR-ACC-001 and FR-ACC-002 on real Postgres.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const second = createDatabase(testDatabaseUrl(), { maxConnections: 2 });

afterAll(async () => {
  await Promise.all([db.destroy(), second.destroy()]);
});

const NOW = new Date("2026-10-01T09:00:00Z");
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

function intent(now = NOW) {
  return createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
}

async function consents(userId: string) {
  return db
    .selectFrom("acc.consent")
    .select(["document", "version"])
    .where("user_id", "=", userId)
    .orderBy("document")
    .execute();
}

describe("sign-in with the declarations (FR-ACC-001)", () => {
  it("creates the account, its empty profile and both acceptances", async () => {
    const userId = await createAuthUser();
    const { id } = await intent();
    expect(await completeSignIn(db, { userId, intentId: id, now: later(30) })).toEqual({
      kind: "created",
    });
    const state = await getAccountState(db, userId);
    expect(state?.setupStep).toBe(1);
    expect(state?.setupComplete).toBe(false);
    expect(state?.pending.terms).toBe(false);
    expect(await consents(userId)).toEqual([
      { document: "privacy", version: CURRENT_VERSIONS.privacy },
      { document: "terms", version: CURRENT_VERSIONS.terms },
    ]);
  });

  it("creates nothing without declarations", async () => {
    const userId = await createAuthUser();
    expect(await completeSignIn(db, { userId, intentId: null, now: NOW })).toEqual({
      kind: "no_account",
    });
    expect(await completeSignIn(db, { userId, intentId: "x".repeat(43), now: NOW })).toEqual({
      kind: "no_account",
    });
    expect(await getAccountState(db, userId)).toBeNull();
  });

  it("refuses expired declarations", async () => {
    const userId = await createAuthUser();
    const { id } = await intent();
    expect(await completeSignIn(db, { userId, intentId: id, now: later(601) })).toEqual({
      kind: "no_account",
    });
  });

  it("uses declarations once: another account can't reuse them", async () => {
    const first = await createAuthUser();
    const other = await createAuthUser();
    const { id } = await intent();
    await completeSignIn(db, { userId: first, intentId: id, now: later(1) });
    expect(await completeSignIn(db, { userId: other, intentId: id, now: later(2) })).toEqual({
      kind: "no_account",
    });
  });

  it("signs the same Google account in again without a second account", async () => {
    const userId = await createAuthUser();
    const { id } = await intent();
    await completeSignIn(db, { userId, intentId: id, now: later(1) });
    expect(await completeSignIn(db, { userId, intentId: null, now: later(2) })).toEqual({
      kind: "signed_in",
    });
    const fresh = await intent(later(3));
    expect(await completeSignIn(db, { userId, intentId: fresh.id, now: later(4) })).toEqual({
      kind: "signed_in",
    });
    const accounts = await db
      .selectFrom("acc.user_account")
      .select("id")
      .where("id", "=", userId)
      .execute();
    expect(accounts).toHaveLength(1);
  });

  it("makes one account when the same callback arrives twice at once", async () => {
    const userId = await createAuthUser();
    const { id } = await intent();
    const outcomes = await Promise.all([
      completeSignIn(db, { userId, intentId: id, now: later(1) }),
      completeSignIn(second, { userId, intentId: id, now: later(1) }),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["created", "signed_in"]);
  });

  it("purges expired intents", async () => {
    const { id } = await intent(new Date("2020-01-01T00:00:00Z"));
    expect(await purgeExpiredSignupIntents(db, NOW)).toBeGreaterThanOrEqual(1);
    const left = await db
      .selectFrom("acc.signup_intent")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    expect(left).toBeUndefined();
  });
});
