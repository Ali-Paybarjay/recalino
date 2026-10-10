import { randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  type ProfileChange,
  saveTeachingPreference,
  updateProfile,
} from "../../../packages/core/src/acc";
import type { Database } from "../../../packages/core/src/db";
import { createCourse, createSession } from "../../../packages/core/src/org";
import {
  type LearnerContext,
  type MemoryObjectStore,
  readPltSettings,
} from "../../../packages/core/src/plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../../../packages/core/src/quota";
import {
  acceptSourceNotice,
  appendContentVersion,
  confirmUploadPart,
  createSource,
  DefaultSourceVerifier,
  readInputContract,
  uploadPartLink,
  verifyUpload,
} from "../../../packages/core/src/src";
import { createAuthUser } from "../../../packages/core/test/auth-users";
import {
  type BaselineSourceMapping,
  baselineLearnerProfile,
  baselineSourceRows,
} from "./baseline-fixtures";
import type { MigrationFixture } from "./haiku55-migration-fixtures";

const shared = new Set(["54322", "54329"]);

/**
 * Only the isolated local Supabase may be used. The fixture helpers otherwise fall back to the
 * shared local database, so both variables must be set and must not name the shared ports.
 * Messages never include a connection string.
 */
export function isolatedDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  for (const name of [
    "LOCAL_TEST_APP_DATABASE_URL",
    "LOCAL_TEST_ADMIN_DATABASE_URL",
    "LOCAL_TEST_POOLER_DATABASE_URL",
  ]) {
    const value = env[name];
    if (value === undefined) {
      if (name === "LOCAL_TEST_POOLER_DATABASE_URL") continue;
      throw new Error(`Set ${name} to the isolated local database`);
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid ${name}`);
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error(`${name} must name a local database`);
    if (!url.port || shared.has(url.port))
      throw new Error(`${name} names the shared local database; use the isolated one`);
  }
  if (env.DATABASE_URL !== undefined) throw new Error("Unset DATABASE_URL for this evaluation");
  return env.LOCAL_TEST_APP_DATABASE_URL as string;
}

const operator = {
  actorId: "synthetic-operator",
  reason: "Synthetic production-path baseline evaluation (isolated local database)",
};

/** Generous synthetic limits; the cost guard, not this policy, bounds real spend. */
export async function configureBaselineCostPolicy(db: Database) {
  await configureCostPolicy(
    db,
    {
      version: "production-path-baseline",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    operator,
  );
}

export interface BaselineCase {
  ctx: LearnerContext;
  sessionId: string;
  courseId: string;
  sources: BaselineSourceMapping[];
}

/**
 * A fresh synthetic learner and class through the production APIs only: profile answers that give
 * the fixture's explanation language, declared level and goal, its example preference, its
 * course and class date; then each fixture source in fixture order as a production upload
 * (verified by the production verifier; class audio is declared and stays on the device) with
 * the fixture's units and blocks appended as its content version.
 */
export async function createBaselineCase(
  db: Database,
  store: MemoryObjectStore,
  fixture: MigrationFixture,
  now = new Date(),
): Promise<BaselineCase> {
  const profile = baselineLearnerProfile(fixture);
  const userId = await createAuthUser();
  const ctx = { userId, requestId: randomUUID() };
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const changes: ProfileChange[] = [
    { field: "first_language", firstLanguage: profile.firstLanguage },
    { field: "explanation_language", explanationLanguage: profile.explanationLanguage },
    { field: "level_goal", level: profile.level, goal: profile.goal },
    { field: "timezone", timezone: "Europe/London" },
  ];
  for (const change of changes) await updateProfile(db, ctx, change, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  if (profile.shorterExamples)
    await saveTeachingPreference(
      db,
      ctx,
      { key: "shorter_examples", origin: "explicit", value: true },
      now,
    );
  const course = await createCourse(db, ctx, { name: profile.course }, { key: randomUUID(), now });
  const session = await createSession(
    db,
    ctx,
    { classDate: profile.classDate, courseId: course.id },
    { key: randomUUID(), now },
  );
  await grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 86400000),
    amounts: amounts({
      document: 1000,
      audio: 36000,
      regeneration: 10,
      storage: 100 * 1024 * 1024,
    }),
    operationKey: randomUUID(),
    ...operator,
  });
  const contract = await readInputContract(db);
  await acceptSourceNotice(db, ctx, contract.noticeVersion, true, now);
  const verifier = new DefaultSourceVerifier();
  const sources: BaselineSourceMapping[] = [];
  for (const row of baselineSourceRows(fixture)) {
    // The class snapshot lists sources by link time; keep the fixture order.
    const at = new Date(now.getTime() + row.index + 1);
    const created = await createSource(
      db,
      ctx,
      { sessionId: session.id, ...row.declaration, operationKey: randomUUID() },
      at,
    );
    if (row.bytes) {
      if (!created.uploadId) throw new Error("baseline_upload_missing");
      const link = await uploadPartLink(
        db,
        store,
        ctx,
        created.uploadId,
        0,
        readPltSettings().storage,
        at,
      );
      if (store.upload(link.url, row.bytes, row.declaration.mimeType) !== 200)
        throw new Error("baseline_upload_rejected");
      await confirmUploadPart(db, store, ctx, created.uploadId, 0, at);
      const manifest = await verifyUpload(db, store, ctx, created.uploadId, { verifier }, at);
      if (manifest.state !== "verified") throw new Error("baseline_upload_not_verified");
    }
    const contentVersionId = await db
      .transaction()
      .execute((tx) => appendContentVersion(tx, ctx, created.assetId, row.content, at));
    sources.push({
      fixtureSourceId: row.fixtureSourceId,
      sourceId: created.assetId,
      fixtureContentVersionId: row.fixtureContentVersionId,
      contentVersionId,
    });
  }
  return { ctx, sessionId: session.id, courseId: course.id, sources };
}
