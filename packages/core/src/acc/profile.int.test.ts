import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { AppError } from "../plt";
import { acceptDocuments, canStartNewProcessing, getAccountState } from "./account";
import { CURRENT_VERSIONS } from "./documents";
import { updateProfile } from "./profile";
import { completeSignIn, createSignupIntent } from "./signup";

// FR-ACC-003 to FR-ACC-007 and D33 on real Postgres.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });

afterAll(async () => {
  await db.destroy();
});

const now = () => new Date();

async function newLearner() {
  const userId = await createAuthUser();
  const { id } = await createSignupIntent(db, {
    versions: CURRENT_VERSIONS,
    ttlSeconds: 600,
    now: now(),
  });
  await completeSignIn(db, { userId, intentId: id, now: now() });
  return { userId, requestId: randomUUID() };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

async function history(userId: string) {
  return db
    .selectFrom("acc.learning_profile_history")
    .select("version")
    .where("user_id", "=", userId)
    .execute();
}

describe("profile setup (FR-ACC-003)", () => {
  it("moves through the seven steps and finishes only with the recording consent", async () => {
    const ctx = await newLearner();
    const step = async (change: Parameters<typeof updateProfile>[2]) =>
      (await updateProfile(db, ctx, change, { now: now() })).setupStep;

    expect(await step({ field: "first_language", firstLanguage: "fa" })).toBe(3);
    expect(
      await step({ field: "explanation_language", explanationLanguage: "first_language" }),
    ).toBe(4);
    expect(await step({ field: "level_goal", level: null, goal: null })).toBe(6);
    expect(await step({ field: "timezone", timezone: "Europe/London" })).toBe(7);

    let state = await getAccountState(db, ctx.userId);
    expect(state?.setupComplete).toBe(false);
    await acceptDocuments(
      db,
      ctx,
      [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
      { now: now() },
    );
    state = await getAccountState(db, ctx.userId);
    expect(state?.setupComplete).toBe(true);
    expect(state?.profile).toMatchObject({
      firstLanguage: "fa",
      learningLanguage: "en",
      explanationLanguage: "first_language",
      level: null,
      goal: null,
    });
    expect(state?.timezone).toBe("Europe/London");
  });

  it("refuses an answer for a step the learner has not reached", async () => {
    const ctx = await newLearner();
    expect(
      await code(
        updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now: now() }),
      ),
    ).toBe("validation_failed");
  });

  it("refuses unknown languages and time zones", async () => {
    const ctx = await newLearner();
    expect(
      await code(
        updateProfile(db, ctx, { field: "first_language", firstLanguage: "xx" }, { now: now() }),
      ),
    ).toBe("validation_failed");
    expect(
      await code(
        updateProfile(db, ctx, { field: "timezone", timezone: "Mars/Olympus" }, { now: now() }),
      ),
    ).toBe("validation_failed");
  });

  it("lets the learner go back and change an earlier answer", async () => {
    const ctx = await newLearner();
    await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now: now() });
    const state = await updateProfile(
      db,
      ctx,
      { field: "first_language", firstLanguage: "ar" },
      { now: now() },
    );
    expect(state.profile.firstLanguage).toBe("ar");
    expect(state.setupStep).toBe(3);
  });
});

describe("profile versions (FR-ACC-004)", () => {
  it("make a new version per change and none for the same values", async () => {
    const ctx = await newLearner();
    await updateProfile(db, ctx, { field: "first_language", firstLanguage: "ru" }, { now: now() });
    const before = (await history(ctx.userId)).length;
    const same = await updateProfile(
      db,
      ctx,
      { field: "first_language", firstLanguage: "ru" },
      { now: now() },
    );
    expect((await history(ctx.userId)).length).toBe(before);
    const changed = await updateProfile(
      db,
      ctx,
      { field: "first_language", firstLanguage: "uk" },
      { now: now() },
    );
    expect(changed.profile.version).toBe(same.profile.version + 1);
    expect((await history(ctx.userId)).length).toBe(before + 1);
  });

  it("keep two changes at once from colliding", async () => {
    const ctx = await newLearner();
    await updateProfile(db, ctx, { field: "first_language", firstLanguage: "de" }, { now: now() });
    await Promise.all([
      updateProfile(db, ctx, { field: "first_language", firstLanguage: "it" }, { now: now() }),
      updateProfile(db, ctx, { field: "first_language", firstLanguage: "ro" }, { now: now() }),
    ]);
    const versions = (await history(ctx.userId)).map((row) => row.version).sort((a, b) => a - b);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe("acceptances (FR-ACC-007, D33)", () => {
  it("refuse a version other than the current one", async () => {
    const ctx = await newLearner();
    expect(
      await code(acceptDocuments(db, ctx, [{ document: "terms", version: "0.0" }], { now: now() })),
    ).toBe("validation_failed");
  });

  it("ask again after a new version, and block new processing until accepted", async () => {
    const ctx = await newLearner();
    const next = { ...CURRENT_VERSIONS, terms: "9.9" };
    expect((await getAccountState(db, ctx.userId, next))?.pending.terms).toBe(true);
    expect(await canStartNewProcessing(db, ctx.userId, next)).toBe(false);
    await acceptDocuments(db, ctx, [{ document: "terms", version: "9.9" }], {
      now: now(),
      versions: next,
    });
    expect(await canStartNewProcessing(db, ctx.userId, next)).toBe(true);
    expect(await canStartNewProcessing(db, ctx.userId)).toBe(true);
  });

  it("ask for the recording consent again only after setup and a new version", async () => {
    const ctx = await newLearner();
    const next = { ...CURRENT_VERSIONS, "recording-consent": "9.9" };
    // During setup the consent screen is the last step anyway.
    expect((await getAccountState(db, ctx.userId, next))?.pending.recordingConsent).toBe(false);
    for (const change of [
      { field: "first_language", firstLanguage: "ja" },
      { field: "explanation_language", explanationLanguage: "english" },
      { field: "level_goal", level: "B1", goal: "general" },
      { field: "timezone", timezone: "Asia/Tokyo" },
    ] as const) {
      await updateProfile(db, ctx, change, { now: now() });
    }
    await acceptDocuments(
      db,
      ctx,
      [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
      { now: now() },
    );
    expect((await getAccountState(db, ctx.userId))?.pending.recordingConsent).toBe(false);
    expect((await getAccountState(db, ctx.userId, next))?.pending.recordingConsent).toBe(true);
  });

  it("are idempotent", async () => {
    const ctx = await newLearner();
    const terms = [{ document: "terms" as const, version: CURRENT_VERSIONS.terms }];
    await acceptDocuments(db, ctx, terms, { now: now() });
    await acceptDocuments(db, ctx, terms, { now: now() });
    const rows = await db
      .selectFrom("acc.consent")
      .select("id")
      .where("user_id", "=", ctx.userId)
      .where("document", "=", "terms")
      .execute();
    expect(rows).toHaveLength(1);
  });
});
