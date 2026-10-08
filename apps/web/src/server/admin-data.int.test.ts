import { randomUUID } from "node:crypto";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import {
  amounts,
  configurePilot,
  grantAdminPilotEntitlement,
  grantEntitlement,
  pilotGrantOperationKey,
  reserveAllowance,
  setAllowanceAllocation,
  settleAllowance,
} from "@recalino/core/quota";
import { createReplyDraft, submitFeedback } from "@recalino/core/support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../../../packages/core/test/auth-users";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { type AdminDirectory, readAdminSnapshot } from "./admin-data";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
afterAll(() => db.destroy());
let actorId: string;
beforeAll(async () => {
  actorId = await createAuthUser();
});
const directory: AdminDirectory = {
  getUser: async (id) => ({ name: `Synthetic ${id}`, email: `${id}@example.test`, language: "en" }),
};
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return { userId, requestId: randomUUID() };
}
async function grant(userId: string) {
  const now = new Date();
  return grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ audio: 600, document: 10 }),
    operationKey: randomUUID(),
    actorId,
    reason: "Synthetic read test",
  });
}
async function email(
  userId: string,
  templateId: string,
  state: string,
  contact = `${userId}@example.test`,
  subject = "Synthetic operational message",
) {
  const id = randomUUID();
  await sql`insert into support.email_outbox(id,user_id,purpose_key,template_id,email,subject,body,language,state)
    values(${id}::uuid,${userId}::uuid,${randomUUID()},${templateId},${contact},
      ${subject},'Authorized support communication body','en',${state})`.execute(db);
  return id;
}

describe("admin metadata snapshots (ADM-I02/I03/I07/I12/I13)", () => {
  it("uses private security-invoker projections with read-only application privileges", async () => {
    const { rows } = await sql<{
      name: string;
      options: string[];
      app_read: boolean;
      app_write: boolean;
      browser_read: boolean;
    }>`select c.relname as name,c.reloptions as options,
      has_table_privilege('recalino_app',c.oid,'SELECT') as app_read,
      (has_table_privilege('recalino_app',c.oid,'INSERT')
        or has_table_privilege('recalino_app',c.oid,'UPDATE')
        or has_table_privilege('recalino_app',c.oid,'DELETE')) as app_write,
      (has_table_privilege('anon',c.oid,'SELECT')
        or has_table_privilege('authenticated',c.oid,'SELECT')) as browser_read
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='ops' and c.relkind='v' and c.relname like 'admin_%'`.execute(db);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.options).toContain("security_invoker=true");
      expect(row).toMatchObject({ app_read: true, app_write: false, browser_read: false });
    }
    const { rows: columns } = await sql<{ column_name: string }>`select column_name
      from information_schema.columns where table_schema='ops' and table_name='admin_source_readiness'`.execute(
      db,
    );
    expect(columns.map((column) => column.column_name)).toContain("requires_ocr");
    expect(columns.some((column) => ["units", "blocks", "key"].includes(column.column_name))).toBe(
      false,
    );
  });

  it("reads all five quota units and preserves consumed/held values after a reduction", async () => {
    const ctx = await learner();
    const entitlementId = await grant(ctx.userId);
    const first = await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 120 })));
    await db
      .transaction()
      .execute((tx) => settleAllowance(tx, ctx, first.id, amounts({ audio: 120 })));
    await db
      .transaction()
      .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 30 })));
    await setAllowanceAllocation(db, {
      userId: ctx.userId,
      entitlementId,
      amounts: amounts({ audio: 100, document: 20, regeneration: 3, tts: 200, storage: 524288000 }),
      operationKey: randomUUID(),
      actorId,
      reason: "Synthetic reduction for browser DTO",
    });
    const snapshot = await readAdminSnapshot(
      db,
      { view: "user", actorId, userId: ctx.userId },
      directory,
      {},
    );
    expect(snapshot.user).toMatchObject({ id: ctx.userId, quotaActive: true, pilot: false });
    expect(snapshot.quota).toMatchObject({
      entitlementId,
      allocated: { audio: 100, document: 20, regeneration: 3, tts: 200, storage: 524288000 },
      consumed: { audio: 120 },
      reserved: { audio: 30 },
      available: { audio: 0 },
    });
    const noGrant = await learner();
    expect(
      (
        await readAdminSnapshot(
          db,
          { view: "user", actorId, userId: noGrant.userId },
          directory,
          {},
        )
      ).quota,
    ).toMatchObject({ entitlementId: null, allocated: amounts({}) });
    await expect(
      readAdminSnapshot(db, { view: "user", actorId, userId: randomUUID() }, directory, {}),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates welcome work only for a granted pilot account and honors delivery and task preferences", async () => {
    const regular = await learner();
    const pilot = await learner();
    const pilotId = `synthetic-${randomUUID()}`;
    const config = {
      version: "synthetic-1",
      pilotId,
      maximumParticipants: 1,
      periodDays: 30,
      amounts: amounts({ document: 2 }),
      operationKey: randomUUID(),
      actorId,
      reason: "Synthetic task fixture",
    };
    await configurePilot(db, config);
    const startsAt = new Date(Date.now() - 1000);
    await grantAdminPilotEntitlement(db, {
      pilotId,
      userId: pilot.userId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 86400000),
      amounts: config.amounts,
      operationKey: pilotGrantOperationKey(pilotId, pilot.userId),
      actorId,
      reason: config.reason,
    });
    const tasks = (userId: string) =>
      readAdminSnapshot(db, { view: "tasks", actorId, userId }, directory, {});
    expect((await tasks(regular.userId)).tasks?.some((task) => task.kind === "pilot_welcome")).toBe(
      false,
    );
    expect((await tasks(pilot.userId)).tasks).toContainEqual(
      expect.objectContaining({ id: `welcome:${pilot.userId}`, userIds: [pilot.userId] }),
    );
    await email(pilot.userId, "account_welcome", "sent");
    expect((await tasks(pilot.userId)).tasks?.some((task) => task.kind === "pilot_welcome")).toBe(
      true,
    );
    await sql`insert into ops.task_preference(task_id,state,reason) values(${`welcome:${pilot.userId}`},'dismissed','Synthetic dismissal')`.execute(
      db,
    );
    expect((await tasks(pilot.userId)).tasks?.some((task) => task.kind === "pilot_welcome")).toBe(
      false,
    );
    await sql`update ops.task_preference set state='snoozed',snoozed_until=${new Date(Date.now() - 1000)} where task_id=${`welcome:${pilot.userId}`}`.execute(
      db,
    );
    expect((await tasks(pilot.userId)).tasks?.some((task) => task.kind === "pilot_welcome")).toBe(
      true,
    );
    await email(pilot.userId, "pilot_welcome", "sent");
    await email(pilot.userId, "pilot_welcome", "failed");
    expect((await tasks(pilot.userId)).tasks?.some((task) => task.kind === "pilot_welcome")).toBe(
      false,
    );
    expect(
      (await readAdminSnapshot(db, { view: "user", actorId, userId: pilot.userId }, directory, {}))
        .user?.welcomeState,
    ).toBe("sent");
  });

  it("reads feedback and hidden administrator drafts only through the support view", async () => {
    const ctx = await learner();
    const thread = await submitFeedback(db, ctx, {
      operationKey: randomUUID(),
      category: "question",
      subject: "Synthetic question",
      body: "Authorized help text",
      emailNotification: false,
    });
    await createReplyDraft(
      db,
      { actorId },
      {
        threadId: thread.id,
        operationKey: randomUUID(),
        body: "Unapproved admin draft",
        language: "fa",
      },
    );
    const snapshot = await readAdminSnapshot(
      db,
      { view: "thread", actorId, threadId: thread.id },
      directory,
      {},
    );
    expect(snapshot.thread).toMatchObject({
      id: thread.id,
      name: `Synthetic ${ctx.userId}`,
      state: "awaiting_reply",
      replyDraft: "Unapproved admin draft",
    });
    expect(snapshot.thread?.messages).toHaveLength(1);
    expect(snapshot.thread?.messages[0]).toMatchObject({
      author: "learner",
      body: "Authorized help text",
    });
    const tasks = await readAdminSnapshot(
      db,
      { view: "tasks", actorId, userId: ctx.userId },
      directory,
      {},
    );
    expect(tasks.tasks).toContainEqual(
      expect.objectContaining({ kind: "feedback", threadId: thread.id }),
    );
    const failed = await email(ctx.userId, "service_notice", "failed");
    const unknown = await email(ctx.userId, "service_notice", "unknown");
    const history = await readAdminSnapshot(
      db,
      { view: "user", actorId, userId: ctx.userId },
      directory,
      {},
    );
    expect(history.emails?.find((message) => message.id === failed)?.retryAllowed).toBe(true);
    expect(history.emails?.find((message) => message.id === unknown)?.retryAllowed).toBe(false);
    expect(JSON.stringify(history)).not.toContain("Authorized support communication body");
  });

  it("hides deleted-account contacts and subjects before asynchronous email purge", async () => {
    const ctx = await learner();
    const contact = `DELETED_CONTACT_${randomUUID()}@example.test`;
    const subject = `DELETED_SUBJECT_${randomUUID()}`;
    const emailId = await email(ctx.userId, "service_notice", "failed", contact, subject);
    const before = await readAdminSnapshot(db, { view: "overview", actorId }, directory, {});
    const history = await readAdminSnapshot(db, { view: "history", actorId }, directory, {});
    expect(history.emails).toContainEqual(
      expect.objectContaining({ id: emailId, email: contact, subject }),
    );
    expect(
      (await readAdminSnapshot(db, { view: "tasks", actorId, userId: ctx.userId }, directory, {}))
        .tasks,
    ).toContainEqual(expect.objectContaining({ id: `email:${emailId}` }));
    await db
      .updateTable("acc.user_account")
      .set({ deleted_at: new Date() })
      .where("id", "=", ctx.userId)
      .execute();
    // The outbox still holds pending purge data; the projections must hide it immediately.
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select("email")
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ email: contact });
    const after = await readAdminSnapshot(db, { view: "overview", actorId }, directory, {});
    expect(after.counts?.failedEmails).toBe((before.counts?.failedEmails ?? 0) - 1);
    const snapshots = [
      after,
      await readAdminSnapshot(db, { view: "history", actorId }, directory, {}),
      await readAdminSnapshot(db, { view: "tasks", actorId, userId: ctx.userId }, directory, {}),
    ];
    expect(snapshots[2]?.tasks).toEqual([]);
    expect(JSON.stringify(snapshots)).not.toContain(contact);
    expect(JSON.stringify(snapshots)).not.toContain(subject);
    expect(JSON.stringify(snapshots)).not.toContain(emailId);
  });

  it("uses trusted-directory search and stable page cursors without duplicates or ungranted quotas", async () => {
    const marker = randomUUID();
    const members = new Map<string, { email: string; name: string; language: "en" }>();
    for (let offset = 0; offset < 58; offset += 5) {
      await Promise.all(
        Array.from({ length: Math.min(5, 58 - offset) }, async (_, index) => {
          const ctx = await learner();
          members.set(ctx.userId, {
            email: `member-${offset + index}-${marker}@example.test`,
            name: `Person ${marker}`,
            language: "en",
          });
        }),
      );
    }
    const searched: AdminDirectory = {
      getUser: async (id) => members.get(id) ?? { email: null, name: null, language: "en" },
    };
    const first = await readAdminSnapshot(
      db,
      { view: "users", actorId, search: marker },
      searched,
      {},
    );
    expect(first.users).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await readAdminSnapshot(
      db,
      { view: "users", actorId, search: marker, cursor: first.nextCursor ?? undefined },
      searched,
      {},
    );
    expect(second.users).toHaveLength(8);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...(first.users ?? []), ...(second.users ?? [])].map((user) => user.id)).size,
    ).toBe(58);
    expect(first.users?.every((user) => !user.pilot && !user.quotaActive)).toBe(true);
    await expect(
      readAdminSnapshot(db, { view: "users", actorId, cursor: "invalid" }, searched, {}),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      readAdminSnapshot(
        db,
        { view: "users", actorId },
        {
          getUser: async () => {
            throw new Error("directory_unavailable");
          },
        },
        {},
      ),
    ).rejects.toThrow("directory_unavailable");
  }, 120000);

  it("blocks retry for missing source bytes and unknown provider outcomes without exposing learning content", async () => {
    const ctx = await learner();
    const course = await db
      .insertInto("org.course")
      .values({
        owner_id: ctx.userId,
        name: "PRIVATE_COURSE_NAME",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const session = await db
      .insertInto("org.class_session")
      .values({
        owner_id: ctx.userId,
        course_id: course.id,
        title: "PRIVATE_CLASS_TITLE",
        class_date: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: ctx.userId,
        kind: "audio",
        declared_mime: "audio/wav",
        size_bytes: 100,
        sha256: "a".repeat(64),
        display_name: "PRIVATE_FILE_NAME",
        contract_version: "1",
        retention: "device_only",
        operation_key: randomUUID(),
        request_hash: "synthetic",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const link = await db
      .insertInto("src.session_source")
      .values({
        user_id: ctx.userId,
        session_id: session.id,
        asset_id: asset.id,
        role: "class_audio",
        selected: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const run = await db
      .insertInto("proc.processing_run")
      .values({
        user_id: ctx.userId,
        session_id: session.id,
        operation_key: randomUUID(),
        request_hash: "synthetic",
        sources_version: 0,
        source_fingerprint: "synthetic",
        input_snapshot: JSON.stringify({ private: "PRIVATE_TRANSCRIPT" }),
        settings: JSON.stringify({ key: "PRIVATE_PROVIDER_KEY" }),
        requested_amounts: JSON.stringify(amounts({})),
        reservation_id: randomUUID(),
        state: "failed",
        last_error: "provider_timeout",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const runs = () => readAdminSnapshot(db, { view: "processing", actorId }, directory, {});
    let snapshot = await runs();
    expect(snapshot.runs?.find((item) => item.id === run.id)).toMatchObject({
      retryAllowed: false,
      title: null,
    });
    const content = await db
      .insertInto("src.content_version")
      .values({
        asset_id: asset.id,
        user_id: ctx.userId,
        origin_key: randomUUID(),
        sha256: "a".repeat(64),
        schema_version: "1",
        provenance: "machine_extraction",
        extraction_settings: JSON.stringify({}),
        units: JSON.stringify([{ id: "audio", kind: "audio", start: 0, end: 1000 }]),
        blocks: JSON.stringify([{ text: "PRIVATE_TRANSCRIPT" }]),
        request_hash: "synthetic",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .updateTable("src.session_source")
      .set({ selected_content_version_id: content.id })
      .where("id", "=", link.id)
      .execute();
    snapshot = await runs();
    expect(snapshot.runs?.find((item) => item.id === run.id)?.retryAllowed).toBe(true);
    await db
      .insertInto("proc.provider_attempt")
      .values({
        run_id: run.id,
        user_id: ctx.userId,
        step: "generation",
        attempt: 1,
        operation_key: randomUUID(),
        hold_id: randomUUID(),
        provider: "synthetic",
        model: "synthetic/model",
        state: "uncertain",
      })
      .execute();
    snapshot = await runs();
    expect(snapshot.runs?.find((item) => item.id === run.id)).toMatchObject({
      retryAllowed: false,
      model: "synthetic/model",
    });
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  });

  it("reads actor-specific preferences and configuration status without returning service credentials", async () => {
    await sql`insert into ops.admin_preference(user_id,language,theme) values(${actorId}::uuid,'en','dark')`.execute(
      db,
    );
    const env = {
      RESEND_API_KEY: "PRIVATE_RESEND_KEY",
      RECALINO_EMAIL_FROM: "Recalino <team@example.test>",
      RECALINO_PUBLIC_APP_URL: "https://recalino.example.test",
      RECALINO_EMAIL_REPLY_TO: "help@example.test",
      OPENROUTER_API_KEY: "PRIVATE_OPENROUTER_KEY",
    };
    const snapshot = await readAdminSnapshot(db, { view: "settings", actorId }, directory, env);
    expect(snapshot.settings).toMatchObject({
      language: "en",
      theme: "dark",
      senderConfigured: true,
      emailProvider: "resend",
      senderEmail: "Recalino <team@example.test>",
      aiConfigured: false,
    });
    for (const secret of [env.RESEND_API_KEY, env.OPENROUTER_API_KEY]) {
      expect(JSON.stringify(snapshot)).not.toContain(secret);
    }
    const gmailEnv = {
      ...env,
      RECALINO_EMAIL_PROVIDER: "gmail",
      RECALINO_GMAIL_USER: "synthetic-pilot@gmail.com",
      RECALINO_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
      RECALINO_EMAIL_FROM: "Recalino <synthetic-pilot@gmail.com>",
    };
    const gmail = await readAdminSnapshot(db, { view: "settings", actorId }, directory, gmailEnv);
    expect(gmail.settings).toMatchObject({
      emailProvider: "gmail",
      senderConfigured: true,
      senderEmail: "Recalino <synthetic-pilot@gmail.com>",
    });
    for (const secret of [
      gmailEnv.RECALINO_GMAIL_APP_PASSWORD,
      "abcdefghijklmnop",
      env.RESEND_API_KEY,
    ])
      expect(JSON.stringify(gmail)).not.toContain(secret);
    const pendingGmail = await readAdminSnapshot(db, { view: "settings", actorId }, directory, {
      ...gmailEnv,
      RECALINO_GMAIL_APP_PASSWORD: undefined,
    });
    expect(pendingGmail.settings).toMatchObject({
      emailProvider: "gmail",
      senderConfigured: false,
    });
    const other = await createAuthUser();
    expect(
      (await readAdminSnapshot(db, { view: "settings", actorId: other }, directory, {})).settings,
    ).toMatchObject({ language: "fa", theme: "system", senderConfigured: false });
    for (const view of [
      "overview",
      "pilot",
      "costs",
      "rates",
      "feedback",
      "templates",
      "history",
      "privacy",
      "backups",
      "audit",
    ] as const) {
      const result = await readAdminSnapshot(db, { view, actorId }, directory, env);
      expect(result.view).toBe(view);
      for (const secret of [env.RESEND_API_KEY, env.OPENROUTER_API_KEY]) {
        expect(JSON.stringify(result)).not.toContain(secret);
      }
    }
  });
});
