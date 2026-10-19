import { sql } from "kysely";
import { z } from "zod";
import { readEstimateRates } from "../aip";
import type { Database } from "../db";
import { getSession } from "../org";
import { compareSchemaVersions, errors, readAppliedSchemaVersion } from "../plt";
import { readClassProcessingReview } from "../proc";
import {
  emptyAmounts,
  providerCostSummary,
  providerSessionCostSummary,
  readEntitlementAllocation,
  readPilotConfiguration,
} from "../quota";
import { getSupportThread, listEmailTemplates, listReplyDrafts } from "../support";
import type {
  AdminCosts,
  AdminEmail,
  AdminQuota,
  AdminRun,
  AdminSettings,
  AdminSnapshot,
  AdminTask,
  AdminUser,
  AdminView,
  AuditItem,
  FeedbackSummary,
  PilotSummary,
  SystemHealth,
} from "./admin-contracts";
import { readSystemHealth } from "./health";

export interface AdminDirectory {
  getUser(
    id: string,
  ): Promise<{ email: string | null; name: string | null; language: "en" | "fa" }>;
}
export interface AdminSnapshotParameters {
  view: AdminView;
  actorId: string;
  userId?: string;
  threadId?: string;
  search?: string;
  cursor?: string;
  runId?: string;
}
export interface AdminReadConfiguration {
  approvedPilot: {
    pilotId: string;
    version: string;
    maximumParticipants: number;
    periodDays: number;
    amounts: AdminQuota["allocated"];
  };
  email: {
    configured: boolean;
    provider?: "resend" | "gmail" | null;
    sender: string | null;
    replyTo: string | null;
    appLink: string | null;
  };
  aiConfigured: boolean;
  /** OPS-05: the newest migration of the deployed code, compared with the database. */
  expectedSchemaVersion?: string;
}
const PAGE_SIZE = 50;
const cursorSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });
type UserCursor = z.infer<typeof cursorSchema>;
interface UserRow {
  id: string;
  created_at: Date;
  pilot: boolean;
  quota_active: boolean;
  welcome_state: string;
}
interface EmailRow {
  id: string;
  user_id: string | null;
  email: string;
  subject: string;
  state: string;
  created_at: Date;
  last_error: string | null;
}
interface ThreadRow {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  email_notification: boolean;
}

function decodeCursor(value?: string): UserCursor | null {
  if (!value) return null;
  try {
    z.string().max(500).parse(value);
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw errors.validationFailed({ cursor: ["invalid_cursor"] });
  }
}
function encodeCursor(row: { id: string; created_at: Date }) {
  return Buffer.from(
    JSON.stringify({ id: row.id, createdAt: row.created_at.toISOString() }),
  ).toString("base64url");
}
function errorCode(value: string | null) {
  return value === null
    ? null
    : /^[a-zA-Z0-9_.:-]{1,200}$/.test(value)
      ? value
      : "operation_failed";
}
function emailView(row: EmailRow): AdminEmail {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    email: row.email,
    subject: row.subject,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    lastError: errorCode(row.last_error),
    retryAllowed: row.state === "failed" && row.user_id !== null,
  };
}

/** Call only behind the verified owner guard. No learning payload, private object key or credential is returned. */
export async function readAdminSnapshot(
  db: Database,
  params: AdminSnapshotParameters,
  directory: AdminDirectory,
  configuration: AdminReadConfiguration,
): Promise<AdminSnapshot> {
  z.uuid().parse(params.actorId);
  const now = new Date();
  // Cache trusted Auth metadata within a single request; never authorize with user-editable names.
  const identities = new Map<string, ReturnType<AdminDirectory["getUser"]>>();
  const cachedDirectory: AdminDirectory = {
    getUser(id) {
      const previous = identities.get(id);
      if (previous) return previous;
      const requested = directory.getUser(id);
      identities.set(id, requested);
      return requested;
    },
  };
  switch (params.view) {
    case "overview": {
      const [pilot, costs, counts, tasks, audit, health] = await Promise.all([
        pilotSummary(db, now, configuration.approvedPilot),
        costsSummary(db, now),
        dashboardCounts(db),
        readTasks(db, now),
        readAudit(db),
        overviewHealth(db, now, configuration.expectedSchemaVersion),
      ]);
      return {
        view: params.view,
        pilot,
        ...(costs ? { costs } : {}),
        counts,
        health,
        tasks,
        audit,
      };
    }
    case "tasks":
      return { view: params.view, tasks: await readTasks(db, now, params.userId) };
    case "users": {
      const page = await readUsers(db, cachedDirectory, now, params.search, params.cursor);
      return { view: params.view, ...page };
    }
    case "user": {
      const userId = z.uuid().parse(params.userId);
      const [user, quota, emails, pilot] = await Promise.all([
        readUser(db, cachedDirectory, userId, now),
        readUserQuota(db, userId, now),
        readEmails(db, userId),
        pilotSummary(db, now, configuration.approvedPilot),
      ]);
      return { view: params.view, user, quota, emails, pilot };
    }
    case "pilot":
      return { view: params.view, pilot: await pilotSummary(db, now, configuration.approvedPilot) };
    case "costs": {
      const costs = await costsSummary(db, now);
      return {
        view: params.view,
        ...(costs ? { costs } : {}),
        ...(params.runId ? { runs: await readRuns(db, now, params.runId) } : {}),
      };
    }
    case "rates": {
      const rates = await readEstimateRates(db);
      return {
        view: params.view,
        rates: rates?.rates ?? [],
        ...(rates ? { rateVersion: rates.version } : {}),
      };
    }
    case "processing":
      return { view: params.view, runs: await readRuns(db, now, params.runId) };
    case "feedback":
      return { view: params.view, threads: await readThreads(db, cachedDirectory) };
    case "thread": {
      const threadId = z.uuid().parse(params.threadId);
      const ctx = { actorId: params.actorId };
      const [thread, drafts] = await Promise.all([
        getSupportThread(db, ctx, threadId),
        listReplyDrafts(db, ctx, threadId),
      ]);
      const person = await cachedDirectory.getUser(thread.userId);
      return {
        view: params.view,
        thread: {
          id: thread.id,
          userId: thread.userId,
          name: person.name,
          email: person.email,
          subject: thread.subject,
          category: thread.category,
          state: thread.status,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          notifyByEmail: thread.emailNotification,
          messages: thread.messages.map((message) => ({ ...message })),
          replyDraft: drafts.find((draft) => draft.state === "draft")?.body ?? null,
        },
      };
    }
    case "templates": {
      const templates = await listEmailTemplates(db);
      return {
        view: params.view,
        templates: templates.map((template) => ({
          id: template.id,
          version: template.version,
          name: template.label,
          subject: { en: template.content.en.subject, fa: template.content.fa.subject },
          body: { en: template.content.en.body, fa: template.content.fa.body },
          variableDefaults: template.variableDefaults,
          presentation: {
            en: template.content.en.presentation,
            fa: template.content.fa.presentation,
          },
        })),
      };
    }
    case "history":
      return { view: params.view, emails: await readEmails(db) };
    case "privacy": {
      const { rows } = await sql<{
        id: string;
        kind: string;
        state: string;
        requested_at: Date;
        last_error: string | null;
      }>`select id,kind,state,requested_at,last_error from ops.admin_privacy
        order by requested_at desc,id desc limit ${PAGE_SIZE}`.execute(db);
      return {
        view: params.view,
        privacy: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          state: row.state,
          createdAt: row.requested_at.toISOString(),
          lastError: errorCode(row.last_error),
        })),
      };
    }
    case "backups": {
      const { rows } = await sql<{
        id: string;
        state: string;
        created_at: Date;
        restore_drilled_at: Date | null;
        last_error: string | null;
        verified_at: Date | null;
      }>`select id,state,created_at,restore_drilled_at,last_error,verified_at from ops.admin_backup
        order by created_at desc,id desc limit ${PAGE_SIZE}`.execute(db);
      return {
        view: params.view,
        backups: rows.map((row) => ({
          id: row.id,
          state: row.state,
          createdAt: row.created_at.toISOString(),
          verifiedAt: row.verified_at?.toISOString() ?? null,
          restoreDrillAt: row.restore_drilled_at?.toISOString() ?? null,
          lastError: errorCode(row.last_error),
        })),
      };
    }
    case "audit":
      return { view: params.view, audit: await readAudit(db) };
    case "settings":
      return { view: params.view, settings: await readSettings(db, params.actorId, configuration) };
  }
}

async function userRows(
  db: Database,
  now: Date,
  cursor: UserCursor | null,
  limit: number,
  userId?: string,
) {
  return (
    await sql<UserRow>`select a.id,a.created_at,a.pilot,
      exists(select 1 from ops.admin_entitlement e where e.user_id=a.id and e.closed_at is null
        and e.starts_at<=${now} and e.ends_at>${now}) as quota_active,a.welcome_state
    from ops.admin_user a where true
      ${userId ? sql`and a.id=${userId}::uuid` : sql``}
      ${cursor ? sql`and (a.created_at,a.id)<(${new Date(cursor.createdAt)},${cursor.id}::uuid)` : sql``}
    order by a.created_at desc,a.id desc limit ${limit}`.execute(db)
  ).rows;
}
async function withIdentity(row: UserRow, directory: AdminDirectory): Promise<AdminUser> {
  const person = await directory.getUser(row.id);
  return {
    id: row.id,
    name: person.name,
    email: person.email,
    createdAt: row.created_at.toISOString(),
    pilot: row.pilot,
    quotaActive: row.quota_active,
    welcomeState: row.welcome_state,
  };
}
async function readUser(db: Database, directory: AdminDirectory, userId: string, now: Date) {
  const rows = await userRows(db, now, null, 1, userId);
  if (!rows[0]) throw errors.notFound();
  return withIdentity(rows[0], directory);
}

async function readUsers(
  db: Database,
  directory: AdminDirectory,
  now: Date,
  search?: string,
  cursor?: string,
) {
  const needle = z
    .string()
    .max(200)
    .parse(search ?? "")
    .trim()
    .toLocaleLowerCase();
  let scanCursor = decodeCursor(cursor);
  const matched: { row: UserRow; user: AdminUser }[] = [];
  // Email/name are resolved only from the injected trusted Auth directory, outside private class data.
  while (matched.length <= PAGE_SIZE) {
    const rows = await userRows(db, now, scanCursor, needle ? 100 : PAGE_SIZE + 1);
    if (rows.length === 0) break;
    for (let index = 0; index < rows.length && matched.length <= PAGE_SIZE; index += 8) {
      const batch = rows.slice(index, index + 8);
      const users = await Promise.all(batch.map((row) => withIdentity(row, directory)));
      for (let item = 0; item < batch.length; item++) {
        const row = batch[item];
        const user = users[item];
        if (!row || !user) continue;
        if (
          !needle ||
          `${user.name ?? ""}\n${user.email ?? ""}`.toLocaleLowerCase().includes(needle)
        )
          matched.push({ row, user });
        if (matched.length > PAGE_SIZE) break;
      }
    }
    if (matched.length > PAGE_SIZE || !needle || rows.length < 100) break;
    const last = rows.at(-1);
    if (!last) break;
    scanCursor = { createdAt: last.created_at.toISOString(), id: last.id };
  }
  const displayed = matched.slice(0, PAGE_SIZE);
  const last = displayed.at(-1);
  return {
    users: displayed.map((result) => result.user),
    nextCursor: matched.length > PAGE_SIZE && last ? encodeCursor(last.row) : null,
  };
}

async function readUserQuota(db: Database, userId: string, now: Date): Promise<AdminQuota> {
  const { rows } = await sql<{ id: string }>`select id from ops.admin_entitlement
    where user_id=${userId}::uuid order by starts_at desc,created_at desc,id desc limit 1`.execute(
    db,
  );
  const entitlement = rows[0];
  if (!entitlement)
    return {
      entitlementId: null,
      allocated: emptyAmounts(),
      consumed: emptyAmounts(),
      reserved: emptyAmounts(),
      available: emptyAmounts(),
      startsAt: null,
      endsAt: null,
    };
  const allocation = await readEntitlementAllocation(db, userId, entitlement.id, now);
  return {
    entitlementId: allocation.entitlementId,
    allocated: allocation.allocated,
    consumed: allocation.used,
    reserved: allocation.reserved,
    available: allocation.available,
    startsAt: allocation.startsAt.toISOString(),
    endsAt: allocation.endsAt.toISOString(),
  };
}

async function pilotSummary(
  db: Database,
  now: Date,
  approvedPilot: AdminReadConfiguration["approvedPilot"],
): Promise<PilotSummary> {
  const config = await readPilotConfiguration(db, approvedPilot.pilotId, now);
  if (config)
    return {
      pilotId: config.pilotId,
      version: config.version,
      capacity: config.maximumParticipants,
      admitted: config.historicalAdmissions,
      active: config.activeParticipants,
      defaults: config.amounts,
      periodDays: config.periodDays,
    };
  // Approved defaults are a form preset, never an implicit grant or invented participant count.
  const result = await sql<{
    historical: string;
    active: string;
  }>`select count(distinct user_id) as historical,
    count(distinct user_id) filter(where closed_at is null and starts_at<=${now} and ends_at>${now}) as active
    from ops.admin_entitlement where pilot_id=${approvedPilot.pilotId}`.execute(db);
  const counts = result.rows[0];
  if (!counts) throw new Error("pilot_counts_missing");
  return {
    pilotId: approvedPilot.pilotId,
    version: approvedPilot.version,
    capacity: approvedPilot.maximumParticipants,
    admitted: Number(counts.historical),
    active: Number(counts.active),
    defaults: approvedPilot.amounts,
    periodDays: approvedPilot.periodDays,
  };
}
async function costsSummary(db: Database, now: Date): Promise<AdminCosts | null> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const summary = await providerCostSummary(db, since);
  if (!summary.policy) return null;
  if (
    summary.policy.currency !== "USD" ||
    summary.costs.some((cost) => cost.currency !== "USD") ||
    summary.unresolvedHolds.some((hold) => hold.currency !== "USD")
  )
    throw new Error("unsupported_cost_currency");
  const { rows } = await sql<{
    count: string;
  }>`select count(*) as count from ops.admin_attempt_outcome
    where state='uncertain' and started_at>=${since}`.execute(db);
  const uncertain = rows[0];
  if (!uncertain) throw new Error("admin_attempt_counts_missing");
  return {
    actualMicros: summary.costs.reduce((sum, cost) => sum + cost.actualMicros, 0),
    estimatedMicros: summary.costs.reduce((sum, cost) => sum + cost.estimatedMicros, 0),
    reservedMicros: summary.unresolvedHolds.reduce((sum, hold) => sum + hold.maximumMicros, 0),
    unknownCount:
      summary.costs.reduce((sum, cost) => sum + cost.unknownAttempts, 0) + Number(uncertain.count),
    currency: "USD",
    version: summary.policy.version,
    killSwitch: summary.policy.killSwitch,
    limits: summary.policy.limits,
  };
}
/**
 * OPS-02/OPS-05: the hourly health check's signals, read now. The applied schema version needs a
 * grant the application role may not have; without it the comparison is "unknown".
 */
async function overviewHealth(
  db: Database,
  now: Date,
  expected: string | undefined,
): Promise<SystemHealth> {
  const applied =
    expected === undefined ? null : await readAppliedSchemaVersion(db).catch(() => null);
  return readSystemHealth(db, now, {
    schema:
      expected === undefined
        ? null
        : { state: compareSchemaVersions(expected, applied), expected, applied },
  });
}
async function dashboardCounts(db: Database) {
  const { rows } = await sql<{
    users: string;
    pending_feedback: string;
    queued_runs: string;
    failed_emails: string;
  }>`
    select users,pending_feedback,queued_runs,failed_emails from ops.admin_counts`.execute(db);
  const row = rows[0];
  if (!row) throw new Error("admin_counts_missing");
  return {
    users: Number(row.users),
    pendingFeedback: Number(row.pending_feedback),
    queuedRuns: Number(row.queued_runs),
    failedEmails: Number(row.failed_emails),
  };
}

async function readEmails(db: Database, userId?: string) {
  const { rows } = await sql<EmailRow>`select id,user_id,email,subject,state,created_at,last_error
    from ops.admin_email where true ${userId ? sql`and user_id=${userId}::uuid` : sql``}
    order by created_at desc,id desc limit ${PAGE_SIZE}`.execute(db);
  return rows.map(emailView);
}

/** Resolve approval IDs through the live metadata view, so deleted recipients stay hidden. */
export async function readApprovedEmailResults(db: Database, ids: string[]): Promise<AdminEmail[]> {
  const parsed = z.array(z.uuid()).max(1000).parse(ids);
  if (!parsed.length) return [];
  const { rows } = await sql<EmailRow>`select id,user_id,email,subject,state,created_at,last_error
    from ops.admin_email where id=any(${parsed}::uuid[])
    order by created_at,id`.execute(db);
  return rows.map(emailView);
}
async function readThreads(db: Database, directory: AdminDirectory): Promise<FeedbackSummary[]> {
  const { rows } = await sql<ThreadRow>`select t.id,t.user_id,t.subject,t.category,t.status,
    t.created_at,t.updated_at,t.email_notification from ops.admin_thread t
    order by t.updated_at desc,t.id desc limit ${PAGE_SIZE}`.execute(db);
  return Promise.all(
    rows.map(async (row) => {
      const person = await directory.getUser(row.user_id);
      return {
        id: row.id,
        userId: row.user_id,
        name: person.name,
        email: person.email,
        subject: row.subject,
        category: row.category,
        state: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        notifyByEmail: row.email_notification,
      };
    }),
  );
}

async function readTasks(db: Database, now: Date, userId?: string): Promise<AdminTask[]> {
  if (userId) z.uuid().parse(userId);
  const { rows } = await sql<{
    id: string;
    kind: string;
    user_id: string | null;
    resource_id: string;
    state: string;
    created_at: Date;
  }>`select c.id,c.kind,c.user_id,c.resource_id,c.state,c.created_at
      from ops.admin_task c
      where (c.preference_state is null or c.preference_state='open'
        or (c.preference_state='snoozed' and c.snoozed_until<=${now}))
      ${userId ? sql`and c.user_id=${userId}::uuid` : sql``}
      order by c.created_at asc,c.id asc limit ${PAGE_SIZE}`.execute(db);
  const titles = {
    pilot_welcome: { en: "Prepare a pilot welcome email", fa: "تهیهٔ ایمیل خوشامدگویی پایلوت" },
    feedback: { en: "Reply to a learner's message", fa: "پاسخ به پیام زبان‌آموز" },
    email: { en: "Review an email delivery problem", fa: "بررسی مشکل ارسال ایمیل" },
    processing: { en: "Review a processing run", fa: "بررسی پردازش نیازمند رسیدگی" },
  };
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: titles[row.kind as keyof typeof titles] ?? {
      en: "Review this task",
      fa: "بررسی این کار",
    },
    ...(row.state === "unknown"
      ? {
          detail: {
            en: "Verify the provider outcome before retrying.",
            fa: "پیش از تلاش دوباره، نتیجهٔ سرویس را بررسی کنید.",
          },
        }
      : {}),
    userIds: row.user_id ? [row.user_id] : [],
    state: row.state,
    createdAt: row.created_at.toISOString(),
    ...(row.kind === "feedback" ? { threadId: row.resource_id } : {}),
    ...(row.kind === "processing" ? { runId: row.resource_id } : {}),
  }));
}

async function readRuns(db: Database, now: Date, runId?: string): Promise<AdminRun[]> {
  if (runId) z.uuid().parse(runId);
  const { rows } = await sql<{
    id: string;
    user_id: string;
    session_id: string;
    kind: string;
    state: string;
    last_error: string | null;
    created_at: Date;
    step: string | null;
    model: string | null;
    retry_allowed: boolean;
  }>`
    select r.id,r.user_id,r.session_id,r.kind,r.state,r.last_error,r.created_at,r.step,r.model,
      (r.kind='class' and r.state='failed' and not r.unresolved_attempt
        and r.id=(select newest.id from ops.admin_processing newest
          where newest.user_id=r.user_id and newest.session_id=r.session_id and newest.kind='class'
          order by newest.created_at desc,newest.id desc limit 1)
        and exists(select 1 from ops.admin_source_readiness s where s.session_id=r.session_id)
        and not exists(select 1 from ops.admin_source_readiness s where s.session_id=r.session_id
          and (s.user_id<>r.user_id or not s.source_live or (
            (not s.content_available or s.requires_ocr) and not coalesce((
              (s.original_available and (s.original_expires_at is null or s.original_expires_at>${now}))
              or s.audio_available_until>${now}),false))))) as retry_allowed
    from ops.admin_processing r
    ${runId ? sql`where r.id=${runId}::uuid and r.kind='class'` : sql``}
    order by r.created_at desc,r.id desc limit ${PAGE_SIZE}`.execute(db);
  return Promise.all(
    rows.map(async (row) => {
      // Read one explicitly targeted class through its owner-aware public API. The general
      // admin table continues to expose operational metadata only, never learning content.
      const ctx = { userId: row.user_id, requestId: "admin-processing-review" };
      const detail = runId
        ? await Promise.all([
            getSession(db, ctx, row.session_id),
            providerSessionCostSummary(db, row.session_id, row.user_id),
            readClassProcessingReview(db, ctx, row.session_id),
          ])
        : null;
      return {
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        title: detail?.[0].displayTitle ?? null,
        sessionId: row.session_id,
        ...(detail ? { costs: detail[1], review: detail[2] } : {}),
        stage: row.step ?? row.kind,
        state: row.state,
        lastError: errorCode(row.last_error),
        createdAt: row.created_at.toISOString(),
        retryAllowed: row.retry_allowed,
        model: row.model,
      };
    }),
  );
}
async function readAudit(db: Database): Promise<AuditItem[]> {
  const { rows } = await sql<{
    id: string;
    action: string;
    actor_id: string;
    reason: string | null;
    subject_id: string;
    created_at: Date;
  }>`select id,action,actor_id,reason,subject_id,created_at from ops.admin_audit
    order by created_at desc,id desc limit ${PAGE_SIZE}`.execute(db);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    reason: row.reason,
    subjectId: row.subject_id,
    createdAt: row.created_at.toISOString(),
  }));
}
async function readSettings(
  db: Database,
  actorId: string,
  configuration: AdminReadConfiguration,
): Promise<AdminSettings> {
  const preference = await db
    .selectFrom("ops.admin_preference")
    .select(["language", "theme"])
    .where("user_id", "=", actorId)
    .executeTakeFirst();
  const status = configuration.email;
  return {
    language: preference?.language === "en" ? "en" : "fa",
    theme:
      preference?.theme === "light" || preference?.theme === "dark" ? preference.theme : "system",
    senderConfigured: status.configured,
    emailProvider: status.provider ?? null,
    senderEmail: status.sender,
    replyTo: status.replyTo,
    appLink: status.appLink,
    aiConfigured: configuration.aiConfigured,
  };
}
