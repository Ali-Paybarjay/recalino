import type { Database, Tx } from "../db";
import { errors, type LearnerContext } from "../plt";
import { CURRENT_VERSIONS, type DocumentId, type DocumentVersions } from "./documents";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "not_sure"] as const;
export type Level = (typeof LEVELS)[number];

export const GOALS = ["esol", "ielts", "general", "none"] as const;
export type Goal = (typeof GOALS)[number];

export type ExplanationLanguage = "english" | "first_language";

/**
 * Setup screens in order (frames A2.1 to A2.7): 1 first language; 3 explanation language (step 2,
 * the learning language, is fixed and shown on screen 3); 4 level and goal (steps 4 and 5);
 * 6 time zone; 7 recording consent. 8 means setup is complete.
 */
export const SETUP_STEPS = [1, 3, 4, 6, 7] as const;
export type SetupStep = (typeof SETUP_STEPS)[number] | 8;

export interface LearningProfile {
  version: number;
  firstLanguage: string | null;
  learningLanguage: "en";
  explanationLanguage: ExplanationLanguage | null;
  level: Level | null;
  goal: Goal | null;
}

export interface AccountState {
  userId: string;
  timezone: string | null;
  profile: LearningProfile;
  setupStep: SetupStep;
  setupComplete: boolean;
  /** Texts with a newer version than the learner accepted (FR-ACC-007, D33 rule 3). */
  pending: { terms: boolean; recordingConsent: boolean };
}

export async function accountExists(db: Database, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom("acc.user_account")
    .select("id")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row !== undefined;
}

/** Serialize domain changes per learner inside the caller's transaction (ADR-0002). */
export async function lockAccount(db: Database | Tx, userId: string): Promise<void> {
  const row = await db
    .selectFrom("acc.user_account")
    .select("id")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw errors.notFound();
}

/** The learner's account, profile and pending acceptances; null when there is no account. */
export async function getAccountState(
  db: Database | Tx,
  userId: string,
  versions: DocumentVersions = CURRENT_VERSIONS,
): Promise<AccountState | null> {
  const row = await db
    .selectFrom("acc.user_account as account")
    .innerJoin("acc.learning_profile as profile", "profile.user_id", "account.id")
    .select([
      "account.id",
      "account.timezone",
      "profile.version",
      "profile.first_language",
      "profile.explanation_language",
      "profile.level",
      "profile.goal",
      "profile.setup_step",
      "profile.completed_at",
    ])
    .where("account.id", "=", userId)
    .where("account.deleted_at", "is", null)
    .executeTakeFirst();
  if (row === undefined) return null;

  const accepted = await acceptances(db, userId);
  const setupComplete = row.completed_at !== null;
  return {
    userId: row.id,
    timezone: row.timezone,
    profile: {
      version: row.version,
      firstLanguage: row.first_language,
      learningLanguage: "en",
      explanationLanguage: row.explanation_language as ExplanationLanguage | null,
      level: row.level as Level | null,
      goal: row.goal as Goal | null,
    },
    setupStep: row.setup_step as SetupStep,
    setupComplete,
    pending: {
      terms: !accepted("terms", versions.terms) || !accepted("privacy", versions.privacy),
      recordingConsent:
        setupComplete && !accepted("recording-consent", versions["recording-consent"]),
    },
  };
}

/** Whether the learner ever accepted a given version of a text (append-only ledger). */
async function acceptances(
  db: Database | Tx,
  userId: string,
): Promise<(document: DocumentId, version: string) => boolean> {
  const rows = await db
    .selectFrom("acc.consent")
    .select(["document", "version"])
    .where("user_id", "=", userId)
    .execute();
  const seen = new Set(rows.map((row) => `${row.document}@${row.version}`));
  return (document, version) => seen.has(`${document}@${version}`);
}

/**
 * FR-ACC-003 step 7, FR-ACC-007 and D33: records the acceptance of the texts the learner saw.
 * A version other than the current one is refused, so a stale page can't accept a newer text.
 * Accepting the recording consent on setup step 7 completes the setup. Repeating it has no effect.
 */
export async function acceptDocuments(
  db: Database,
  ctx: LearnerContext,
  acceptances: ReadonlyArray<{ document: DocumentId; version: string }>,
  options: { now: Date; versions?: DocumentVersions },
): Promise<void> {
  const versions = options.versions ?? CURRENT_VERSIONS;
  const outdated = acceptances.filter((item) => item.version !== versions[item.document]);
  if (outdated.length > 0) {
    throw errors.validationFailed(
      Object.fromEntries(outdated.map((item) => [item.document, ["outdated_version"]])),
    );
  }
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await tx
      .insertInto("acc.consent")
      .values(
        acceptances.map((item) => ({
          user_id: ctx.userId,
          document: item.document,
          version: item.version,
          accepted_at: options.now,
        })),
      )
      .onConflict((conflict) => conflict.columns(["user_id", "document", "version"]).doNothing())
      .execute();
    if (acceptances.some((item) => item.document === "recording-consent")) {
      await tx
        .updateTable("acc.learning_profile")
        .set({ setup_step: 8, completed_at: options.now, updated_at: options.now })
        .where("user_id", "=", ctx.userId)
        .where("setup_step", "=", 7)
        .execute();
    }
  });
}

/**
 * FR-ACC-007: until the current Terms and Privacy Notice are accepted, no new processing starts.
 * Reading, export and deletion stay open. PROC calls this before starting a run.
 */
export async function canStartNewProcessing(
  db: Database,
  userId: string,
  versions: DocumentVersions = CURRENT_VERSIONS,
): Promise<boolean> {
  const state = await getAccountState(db, userId, versions);
  return state !== null && !state.pending.terms;
}

/** Cleanup and financial receipts may lock a tombstoned account, without re-enabling product access. */
export async function lockAccountForCleanup(db: Database | Tx, userId: string): Promise<boolean> {
  const account = await db
    .selectFrom("acc.user_account")
    .select("id")
    .where("id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  return account !== undefined;
}
export async function tombstoneAccount(
  tx: Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  await tx
    .updateTable("acc.user_account")
    .set({ deleted_at: now, timezone: null })
    .where("id", "=", ctx.userId)
    .where("deleted_at", "is", null)
    .execute();
}
export async function purgeAccountProfile(tx: Tx, ctx: LearnerContext): Promise<void> {
  const account = await tx
    .selectFrom("acc.user_account")
    .select("deleted_at")
    .where("id", "=", ctx.userId)
    .executeTakeFirst();
  if (account && !account.deleted_at) throw errors.conflict();
  await tx.deleteFrom("acc.learning_profile_history").where("user_id", "=", ctx.userId).execute();
  await tx.deleteFrom("acc.learning_profile").where("user_id", "=", ctx.userId).execute();
  await tx.deleteFrom("acc.preference").where("user_id", "=", ctx.userId).execute();
  await tx.deleteFrom("acc.consent").where("user_id", "=", ctx.userId).execute();
}
