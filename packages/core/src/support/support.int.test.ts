import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "../acc";
import { createDatabase } from "../db";
import type { EmailDraftInput, EmailProvider } from "./index";
import {
  addFeedbackMessage,
  approveEmailDraft,
  approveReply,
  createEmailDraft,
  createReplyDraft,
  getEmailDraft,
  getFeedbackThread,
  listEmails,
  listFeedback,
  listReplyDrafts,
  purgeSupportUser,
  retryEmail,
  runEmailOutbox,
  submitFeedback,
  updateEmailDraft,
  updateReplyDraft,
} from "./index";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
const owner = { actorId: "test-support-owner" };
async function learner() {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return { userId, requestId: randomUUID() };
}
function input() {
  return {
    operationKey: randomUUID(),
    category: "question" as const,
    subject: "Synthetic question",
    body: "How can I share an idea?",
    emailNotification: true,
  };
}
function emailInput(userId: string): EmailDraftInput {
  return {
    operationKey: randomUUID(),
    recipients: [
      { userId, email: `${userId}@example.test`, firstName: "Synthetic learner", language: "en" },
    ],
    templateId: "pilot_welcome",
    language: "en",
    variables: { app_link: "https://example.invalid", pilot_id: randomUUID() },
    reason: "Synthetic approved-email test",
  };
}
describe("AC-FBK-001/002/003/004 ownership, idempotency and approval", () => {
  it("deduplicates submit, isolates accounts, preserves user body and reopens follow-up", async () => {
    const [alice, bob] = await Promise.all([learner(), learner()]);
    const request = input();
    const first = await submitFeedback(db, alice, request);
    expect((await submitFeedback(db, alice, request)).id).toBe(first.id);
    expect((await listFeedback(db, bob)).map((t) => t.id)).not.toContain(first.id);
    await expect(getFeedbackThread(db, bob, first.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      addFeedbackMessage(db, bob, first.id, { body: "Intruder", operationKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(submitFeedback(db, alice, { ...request, body: "Changed" })).rejects.toMatchObject({
      code: "idempotency_mismatch",
    });
    const next = { body: "More details", operationKey: randomUUID() };
    await addFeedbackMessage(db, alice, first.id, next);
    expect((await addFeedbackMessage(db, alice, first.id, next)).messages).toHaveLength(2);
  });
  it("never publishes draft text; approval is revision-bound and retry publishes one reply", async () => {
    const alice = await learner();
    const thread = await submitFeedback(db, alice, input());
    let draft = await createReplyDraft(db, owner, {
      threadId: thread.id,
      operationKey: randomUUID(),
      language: "en",
    });
    expect((await getFeedbackThread(db, alice, thread.id)).messages).toHaveLength(1);
    draft = await updateReplyDraft(db, owner, draft.id, {
      revision: draft.revision,
      body: "Reviewed exact response",
      language: "en",
    });
    await expect(
      approveReply(db, owner, {
        draftId: draft.id,
        revision: 1,
        reason: "Test",
        notifyByEmail: false,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const approval = {
      draftId: draft.id,
      revision: draft.revision,
      reason: "Verified routine response",
      recipient: {
        userId: alice.userId,
        email: `${alice.userId}@example.test`,
        language: "en" as const,
      },
      appLink: "https://example.invalid",
    };
    const result = await approveReply(db, owner, approval);
    expect((await approveReply(db, owner, approval)).messageId).toBe(result.messageId);
    const live = await getFeedbackThread(db, alice, thread.id);
    expect(live.messages).toHaveLength(2);
    expect(live.messages[1]?.body).toBe("Reviewed exact response");
    expect((await listReplyDrafts(db, owner, thread.id))[0]?.state).toBe("approved");
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(1);
  });
  it("respects learner opt-out even when the admin requests an email", async () => {
    const alice = await learner();
    const thread = await submitFeedback(db, alice, { ...input(), emailNotification: false });
    const draft = await createReplyDraft(db, owner, {
      threadId: thread.id,
      operationKey: randomUUID(),
      body: "Reviewed",
      language: "en",
    });
    expect(
      (
        await approveReply(db, owner, {
          draftId: draft.id,
          revision: 1,
          notifyByEmail: true,
          reason: "Approved test",
          close: true,
        })
      ).emailQueued,
    ).toBe(false);
    expect((await getFeedbackThread(db, alice, thread.id)).status).toBe("closed");
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(0);
    await addFeedbackMessage(db, alice, thread.id, {
      operationKey: randomUUID(),
      body: "Another question",
    });
    expect((await getFeedbackThread(db, alice, thread.id)).status).toBe("awaiting_reply");
  });
  it("cancels an approved but unsent reply notification when the learner later opts out", async () => {
    const alice = await learner();
    const thread = await submitFeedback(db, alice, input());
    const draft = await createReplyDraft(db, owner, {
      threadId: thread.id,
      operationKey: randomUUID(),
      body: "Reviewed synthetic reply",
      language: "en",
    });
    await approveReply(db, owner, {
      draftId: draft.id,
      revision: 1,
      notifyByEmail: true,
      recipient: { userId: alice.userId, email: `${alice.userId}@example.test`, language: "en" },
      reason: "Synthetic approved notification",
    });
    await addFeedbackMessage(db, alice, thread.id, {
      operationKey: randomUUID(),
      body: "Please reply only inside the app now.",
      emailNotification: false,
    });
    const sent: string[] = [];
    await runEmailOutbox(db, {
      provider: {
        send: async (message) => {
          sent.push(message.id);
          return { state: "sent", providerId: `synthetic:${message.id}` };
        },
      },
      limit: 25,
    });
    const email = (await listEmails(db, owner, { userId: alice.userId }))[0];
    expect(email?.state).toBe("cancelled");
    expect(email?.lastError).toBe("notification_preference_changed");
    expect(sent).not.toContain(email?.id);
    expect(
      (await getFeedbackThread(db, alice, thread.id)).messages.some(
        (message) => message.body === "Reviewed synthetic reply",
      ),
    ).toBe(true);
  });
});
describe("AC-ADM-008/009/010/011 durable immutable mail approval", () => {
  it("supports exact freeform snapshots without creating a welcome send", async () => {
    const alice = await learner();
    const request = emailInput(alice.userId);
    const draft = await createEmailDraft(db, owner, {
      ...request,
      templateId: null,
      subject: "Manual subject",
      body: "Hello {{first_name}}, this is an approved freeform note.",
    });
    expect(draft.templateId).toBeNull();
    expect(draft.templateVersion).toBe("custom");
    const receipt = await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 });
    expect(receipt.emails[0]?.body).toBe(
      "Hello Synthetic learner, this is an approved freeform note.",
    );
    const welcome = await createEmailDraft(db, owner, { ...request, operationKey: randomUUID() });
    await approveEmailDraft(db, owner, { draftId: welcome.draftId, revision: 1 });
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(2);
  });
  it("requires complete personalized preview and exact revision; edits never mutate an approved send", async () => {
    const alice = await learner();
    const request = emailInput(alice.userId);
    let draft = await createEmailDraft(db, owner, { ...request, variables: {} });
    expect(await listEmails(db, owner, { draftId: draft.draftId })).toHaveLength(0);
    await expect(
      approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    draft = await updateEmailDraft(db, owner, draft.draftId, 1, request);
    await expect(
      approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
    const receipt = await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 2 });
    expect(receipt.emails).toHaveLength(1);
    expect(receipt.emails[0]?.body).toBe(draft.recipients[0]?.body);
    const replay = await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 2 });
    expect(replay.emails[0]?.id).toBe(receipt.emails[0]?.id);
    await expect(
      updateEmailDraft(db, owner, draft.draftId, 2, { ...request, body: "Changed after approve" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      getEmailDraft(db, { actorId: "other-owner" }, draft.draftId),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("deduplicates a welcome purpose across separate drafts", async () => {
    const alice = await learner();
    const request = emailInput(alice.userId);
    const a = await createEmailDraft(db, owner, request);
    await approveEmailDraft(db, owner, { draftId: a.draftId, revision: 1 });
    const b = await createEmailDraft(db, owner, { ...request, operationKey: randomUUID() });
    const duplicate = await approveEmailDraft(db, owner, { draftId: b.draftId, revision: 1 });
    expect(duplicate.emails).toHaveLength(1);
    expect(duplicate.emails[0]?.draftId).toBe(a.draftId);
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(1);
  });
  it("keeps unconfigured queues truthful, records failed versus unknown, and prevents successful/unknown retry", async () => {
    const alice = await learner();
    const draft = await createEmailDraft(db, owner, emailInput(alice.userId));
    await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 });
    expect((await runEmailOutbox(db, { env: {} })).configured).toBe(false);
    expect((await listEmails(db, owner, { draftId: draft.draftId }))[0]?.state).toBe("queued");
    const provider: EmailProvider = {
      send: async (message) =>
        message.draftId === draft.draftId
          ? { state: "failed", error: "provider_422" }
          : { state: "sent", providerId: `synthetic:${message.id}` },
    };
    await runEmailOutbox(db, { provider, limit: 25 });
    const failed = (await listEmails(db, owner, { draftId: draft.draftId }))[0];
    if (!failed) throw new Error("Missing synthetic failed send");
    expect(failed.state).toBe("failed");
    await retryEmail(db, owner, failed.id, "Verified fix in synthetic sender config");
    await runEmailOutbox(db, {
      provider: { send: async () => ({ state: "unknown", error: "timeout" }) },
      limit: 25,
    });
    expect((await listEmails(db, owner, { draftId: draft.draftId }))[0]?.state).toBe("unknown");
    await expect(
      retryEmail(db, owner, failed.id, "Blind retry must not send"),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("preserves a later active send when an overlapping worker sweeps after the first worker has run six minutes", async () => {
    const alice = await learner();
    const request = {
      ...emailInput(alice.userId),
      templateId: null,
      subject: "Synthetic send lease",
      body: "Owner approved synthetic send.",
    };
    const first = await createEmailDraft(db, owner, request);
    const firstReceipt = await approveEmailDraft(db, owner, {
      draftId: first.draftId,
      revision: 1,
    });
    const second = await createEmailDraft(db, owner, { ...request, operationKey: randomUUID() });
    const secondReceipt = await approveEmailDraft(db, owner, {
      draftId: second.draftId,
      revision: 1,
    });
    const firstId = firstReceipt.emails[0]?.id;
    const secondId = secondReceipt.emails[0]?.id;
    if (!firstId || !secondId) throw new Error("Missing synthetic send lease fixture");
    // Prioritize only this suite's two rows; unrelated local fixture content is never removed.
    await sql`update support.email_outbox set created_at='2000-01-01T00:00:00Z' where id=${firstId}::uuid`.execute(
      db,
    );
    await sql`update support.email_outbox set created_at='2000-01-02T00:00:00Z' where id=${secondId}::uuid`.execute(
      db,
    );
    const started = new Date();
    const later = new Date(started.getTime() + 6 * 60000);
    let sweptDuringSecondSend = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started);
    try {
      await runEmailOutbox(db, {
        limit: 2,
        now: started,
        provider: {
          send: async (message) => {
            if (message.id === firstId) vi.setSystemTime(later);
            if (message.id === secondId) {
              sweptDuringSecondSend = true;
              await runEmailOutbox(db, {
                limit: 1,
                now: new Date(later.getTime() + 1000),
                provider: {
                  send: async (other) => ({ state: "sent", providerId: `synthetic:${other.id}` }),
                },
              });
            }
            return { state: "sent", providerId: `synthetic:${message.id}` };
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
    expect(sweptDuringSecondSend).toBe(true);
    const rows = await listEmails(db, owner, { userId: alice.userId });
    expect(rows.find((email) => email.id === secondId)).toMatchObject({
      state: "sent",
      providerId: `synthetic:${secondId}`,
      lastError: null,
    });
    expect(rows.find((email) => email.id === firstId)?.state).toBe("sent");
  });
  it("purges user communications, drafts and private feedback without leaving sendable mail", async () => {
    const alice = await learner();
    await submitFeedback(db, alice, input());
    const draft = await createEmailDraft(db, owner, emailInput(alice.userId));
    await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 });
    await purgeSupportUser(db, alice.userId);
    expect(await listFeedback(db, alice)).toHaveLength(0);
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(0);
    await expect(getEmailDraft(db, owner, draft.draftId)).rejects.toMatchObject({
      code: "not_found",
    });
    const roles = (
      await sql<{
        role_name: string;
      }>`select grantee as role_name from information_schema.table_privileges where table_schema='support' and grantee in ('anon','authenticated')`.execute(
        db,
      )
    ).rows;
    expect(roles).toHaveLength(0);
  });
  it("cancels stale or unavailable recipient addresses before any provider dispatch", async () => {
    const alice = await learner();
    const request = emailInput(alice.userId);
    const draft = await createEmailDraft(db, owner, request);
    const original = await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 });
    const sentIds: string[] = [];
    const provider: EmailProvider = {
      send: async (message) => {
        sentIds.push(message.id);
        return { state: "sent", providerId: `synthetic:${message.id}` };
      },
    };
    await runEmailOutbox(db, {
      provider,
      resolveRecipientEmail: async (userId) =>
        userId === alice.userId ? "changed@example.test" : `${userId}@example.test`,
      limit: 25,
    });
    const result = (await listEmails(db, owner, { draftId: draft.draftId }))[0];
    expect(result?.state).toBe("cancelled");
    expect(result?.lastError).toBe("recipient_address_changed");
    expect(sentIds).not.toContain(result?.id);
    const corrected = {
      ...request,
      recipients: [
        {
          ...request.recipients[0],
          userId: alice.userId,
          email: "changed@example.test",
          language: "en" as const,
        },
      ],
      body: "Owner reviewed this replacement for {{first_name}}.",
    };
    const replacements = await Promise.all(
      [randomUUID(), randomUUID()].map((operationKey) =>
        createEmailDraft(db, owner, { ...corrected, operationKey }),
      ),
    );
    const approvals = await Promise.all(
      replacements.map((replacement) =>
        approveEmailDraft(db, owner, { draftId: replacement.draftId, revision: 1 }),
      ),
    );
    expect(approvals[0]?.emails[0]?.state).toBe("queued");
    expect(approvals[0]?.emails[0]?.id).toBe(approvals[1]?.emails[0]?.id);
    expect(approvals[0]?.emails[0]?.email).toBe("changed@example.test");
    expect(approvals[0]?.emails[0]?.body).toBe(
      "Owner reviewed this replacement for Synthetic learner.",
    );
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(2);
    const oldReplay = await approveEmailDraft(db, owner, { draftId: draft.draftId, revision: 1 });
    expect(oldReplay.emails[0]?.id).toBe(original.emails[0]?.id);
    expect(oldReplay.emails[0]?.state).toBe("cancelled");
    expect(oldReplay.emails[0]?.body).toBe(original.emails[0]?.body);
    await runEmailOutbox(db, {
      provider,
      resolveRecipientEmail: async (userId) =>
        userId === alice.userId ? "changed@example.test" : `${userId}@example.test`,
      limit: 25,
    });
    expect(sentIds).toContain(approvals[0]?.emails[0]?.id);
    expect(sentIds).not.toContain(original.emails[0]?.id);
    const afterSent = await createEmailDraft(db, owner, {
      ...corrected,
      operationKey: randomUUID(),
    });
    const repeated = await approveEmailDraft(db, owner, {
      draftId: afterSent.draftId,
      revision: 1,
    });
    expect(repeated.emails[0]?.id).toBe(approvals[0]?.emails[0]?.id);
    expect(repeated.emails[0]?.state).toBe("sent");
    expect(await listEmails(db, owner, { userId: alice.userId })).toHaveLength(2);
  });
});
