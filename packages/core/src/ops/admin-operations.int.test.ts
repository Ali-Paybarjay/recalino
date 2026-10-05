import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "../acc";
import { createDatabase } from "../db";
import { isAdminOwner } from "../plt";
import {
  addFeedbackMessage,
  approveReply,
  createReplyDraft,
  getFeedbackThread,
  submitFeedback,
} from "../support";
import {
  adminOperation,
  claimAdminRequest,
  updateAdminPreferences,
  updateAdminTask,
} from "./admin-operations";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());

describe("AC-ADM-002/004 durable owner request decisions", () => {
  it("binds a request key to the full envelope including user, email choice, close decision and action", async () => {
    const actorId = await createAuthUser();
    const key = randomUUID();
    const input = {
      action: "feedback.reply",
      input: {
        threadId: randomUUID(),
        body: "Reviewed synthetic reply",
        language: "en",
        notifyByEmail: false,
        close: false,
      },
    };
    await Promise.all([
      claimAdminRequest(db, actorId, key, input),
      claimAdminRequest(db, actorId, key, input),
    ]);
    await claimAdminRequest(db, actorId, key, { input: input.input, action: input.action });
    for (const changed of [
      { ...input, action: "feedback.close" },
      { ...input, input: { ...input.input, notifyByEmail: true } },
      { ...input, input: { ...input.input, close: true } },
      { ...input, input: { ...input.input, threadId: randomUUID() } },
    ])
      await expect(claimAdminRequest(db, actorId, key, changed)).rejects.toMatchObject({
        code: "idempotency_mismatch",
      });
    expect(await isAdminOwner(db, actorId)).toBe(false);
    expect(await isAdminOwner(db, "untrusted-invalid-claim")).toBe(false);
  });

  it("commits a concurrent mutation once and never re-applies an old status over a later update", async () => {
    const actorId = await createAuthUser();
    const key = randomUUID();
    const task = {
      taskId: `synthetic:${randomUUID()}`,
      state: "dismissed" as const,
      reason: "Synthetic owner decision",
    };
    let effects = 0;
    const effect = async () =>
      adminOperation(db, actorId, key, task, "admin.task_update", task.reason, async (tx) => {
        effects++;
        await updateAdminTask(tx, task);
        return { ok: true, receiptId: randomUUID() };
      });
    const results = await Promise.all([effect(), effect()]);
    expect(results[0]).toEqual(results[1]);
    expect(effects).toBe(1);
    await db.transaction().execute((tx) => updateAdminTask(tx, { ...task, state: "open" }));
    expect(await effect()).toEqual(results[0]);
    const row = (
      await sql<{
        state: string;
      }>`select state from ops.task_preference where task_id=${task.taskId}`.execute(db)
    ).rows[0];
    expect(row?.state).toBe("open");
    expect(effects).toBe(1);
    await expect(
      adminOperation(
        db,
        actorId,
        key,
        { ...task, state: "open" },
        "admin.task_update",
        task.reason,
        async () => ({ ok: true }),
      ),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  });

  it("rolls back both a failed effect and its receipt, then permits the same reviewed request to succeed", async () => {
    const actorId = await createAuthUser();
    const key = randomUUID();
    const preference = { actorId, language: "fa" as const, theme: "dark" as const };
    const attempt = (fail: boolean) =>
      adminOperation(
        db,
        actorId,
        key,
        preference,
        "admin.preferences",
        "Synthetic preference decision",
        async (tx) => {
          await updateAdminPreferences(tx, preference);
          if (fail) throw new Error("Synthetic rollback");
          return { ok: true };
        },
      );
    await expect(attempt(true)).rejects.toThrow("Synthetic rollback");
    expect(
      (
        await sql`select user_id from ops.admin_preference where user_id=${actorId}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`select operation_key from ops.admin_operation where actor_id=${actorId}::uuid and operation_key=${key}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(await attempt(false)).toEqual({ ok: true });
    expect(
      (
        await sql<{
          language: string;
          theme: string;
        }>`select language,theme from ops.admin_preference where user_id=${actorId}::uuid`.execute(
          db,
        )
      ).rows[0],
    ).toMatchObject({ language: "fa", theme: "dark" });
  });
  it("replays a reply-and-close receipt without closing a new learner follow-up or publishing twice", async () => {
    const [actorId, userId] = await Promise.all([createAuthUser(), createAuthUser()]);
    const now = new Date();
    const intent = await createSignupIntent(db, {
      versions: CURRENT_VERSIONS,
      ttlSeconds: 60,
      now,
    });
    await completeSignIn(db, { userId, intentId: intent.id, now });
    const learner = { userId, requestId: randomUUID() };
    const thread = await submitFeedback(db, learner, {
      operationKey: randomUUID(),
      category: "question",
      subject: "Synthetic receipt question",
      body: "Please help.",
      emailNotification: false,
    });
    const key = randomUUID();
    const input = {
      threadId: thread.id,
      body: "Owner reviewed this reply.",
      language: "en" as const,
      notifyByEmail: false,
      close: true,
    };
    await claimAdminRequest(db, actorId, key, { action: "feedback.reply", input });
    const draft = await createReplyDraft(
      db,
      { actorId },
      { threadId: thread.id, body: input.body, language: input.language, operationKey: key },
    );
    const approve = () =>
      adminOperation(db, actorId, key, input, "feedback.reply", "Synthetic reviewed reply", (tx) =>
        approveReply(
          tx,
          { actorId },
          {
            draftId: draft.id,
            revision: draft.revision,
            notifyByEmail: false,
            close: true,
            reason: "Synthetic approved reply",
          },
        ),
      );
    const receipt = await approve();
    expect((await getFeedbackThread(db, learner, thread.id)).status).toBe("closed");
    await addFeedbackMessage(db, learner, thread.id, {
      operationKey: randomUUID(),
      body: "A new question after the reply.",
    });
    expect(await approve()).toEqual(receipt);
    const current = await getFeedbackThread(db, learner, thread.id);
    expect(current.status).toBe("awaiting_reply");
    expect(current.messages.filter((message) => message.author === "admin")).toHaveLength(1);
    await expect(
      claimAdminRequest(db, actorId, key, {
        action: "feedback.reply",
        input: { ...input, close: false },
      }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  });
});
