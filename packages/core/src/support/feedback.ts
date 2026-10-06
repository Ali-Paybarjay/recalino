import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { accountExists } from "../acc";
import { errors, type LearnerContext } from "../plt";
import {
  audit,
  ensureHash,
  fingerprint,
  iso,
  learnerLock,
  requireAccount,
  requireActor,
  type SupportDb,
  transaction,
} from "./common";
import {
  type AdminSupportContext,
  type EmailPresentationInput,
  type EmailRecipient,
  emailPresentationInputSchema,
  type FeedbackInput,
  type FeedbackMessage,
  type FeedbackSummary,
  type FeedbackThread,
  feedbackInputSchema,
  type ReplyDraft,
  type ReplyDraftInput,
  type ReplyEmailPreview,
  recipientSchema,
  replyDraftInputSchema,
} from "./contracts";
import {
  renderEmailPresentation,
  safeEmailActionUrl,
  validateEmailPresentation,
} from "./presentation";

interface ThreadRow {
  id: string;
  user_id: string;
  category: FeedbackInput["category"];
  subject: string;
  status: FeedbackSummary["status"];
  email_notification: boolean;
  context: FeedbackInput["context"] | null;
  created_at: Date;
  updated_at: Date;
  read_at: Date | null;
  last_admin_at: Date | null;
  request_hash: string;
}
interface ReplyRow {
  id: string;
  thread_id: string;
  actor_id: string;
  revision: number;
  body: string;
  language: "en" | "fa";
  source: "routine" | "manual";
  state: "draft" | "approved";
  approved_at: Date | null;
  approved_message_id: string | null;
  request_hash: string;
  email_preview?: unknown;
}
function summary(row: ThreadRow): FeedbackSummary {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    subject: row.subject,
    status: row.status,
    emailNotification: row.email_notification,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    unread: !!row.last_admin_at && (!row.read_at || row.last_admin_at > row.read_at),
  };
}
function reply(row: ReplyRow): ReplyDraft {
  return {
    id: row.id,
    threadId: row.thread_id,
    revision: row.revision,
    body: row.body,
    language: row.language,
    source: row.source,
    state: row.state,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    emailPreview: row.email_preview == null ? null : readReplyEmailPreview(row.email_preview),
  };
}
function readReplyEmailPreview(value: unknown): ReplyEmailPreview {
  const preview = z
    .strictObject({
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(24000),
      presentation: z.unknown(),
      recipient: z.strictObject({ userId: z.uuid(), email: z.email().max(320) }).optional(),
    })
    .parse(value);
  const presentation = validateEmailPresentation(preview.presentation);
  if (presentation.body !== preview.body) throw errors.conflict();
  return { ...preview, presentation };
}
function makeReplyEmailPreview(
  thread: ThreadRow,
  language: "en" | "fa",
  responseBody: string,
  value: { recipient?: EmailRecipient; appLink?: string; presentation?: EmailPresentationInput },
): ReplyEmailPreview {
  const recipient = value.recipient;
  if (recipient && recipient.userId !== thread.user_id)
    throw errors.validationFailed({ recipient: ["verified_account_email_required"] });
  const link = value.appLink
    ? safeEmailActionUrl(new URL(`/help/${thread.id}`, safeEmailActionUrl(value.appLink)).href)
    : "";
  const subject = `${language === "fa" ? "پاسخ: " : "Re: "}${thread.subject}`;
  const body = responseBody + (link ? `\n\n${link}` : "");
  const variables: Record<string, string> = {
    first_name: recipient?.firstName?.trim() || (language === "fa" ? "دوست عزیز" : "there"),
    account_email: recipient?.email ?? "",
    conversation_subject: thread.subject,
    reply_text: responseBody,
    app_link: value.appLink ?? "",
    conversation_link: link,
  };
  const substitute = (text: string) =>
    text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(key) || !Object.hasOwn(variables, key) || !variables[key])
        throw errors.validationFailed({ variables: ["unresolved_variables"] });
      return variables[key];
    });
  const action =
    value.presentation?.action === null
      ? null
      : value.presentation?.action
        ? {
            label: substitute(value.presentation.action.label),
            url: substitute(value.presentation.action.url),
          }
        : link
          ? { label: language === "fa" ? "مشاهدهٔ پاسخ" : "View reply", url: link }
          : null;
  const presentation = renderEmailPresentation({
    language,
    subject,
    body,
    templateId: "support_reply",
    presentation: {
      ...(value.presentation?.headline
        ? { headline: substitute(value.presentation.headline) }
        : {}),
      ...(value.presentation?.preheader !== undefined
        ? { preheader: substitute(value.presentation.preheader) }
        : {}),
      action,
    },
  });
  return {
    subject,
    body,
    presentation,
    ...(recipient?.userId
      ? { recipient: { userId: recipient.userId, email: recipient.email } }
      : {}),
  };
}
async function threadRow(db: SupportDb, id: string, lock = false): Promise<ThreadRow> {
  const row = (
    await sql<ThreadRow>`select * from support.thread where id=${z.uuid().parse(id)}::uuid ${lock ? sql`for update` : sql``}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw errors.notFound();
  await requireAccount(db, row.user_id);
  return row;
}
async function messages(db: SupportDb, id: string): Promise<FeedbackMessage[]> {
  const rows = (
    await sql<{
      id: string;
      author: "learner" | "admin";
      body: string;
      created_at: Date;
    }>`select id,author,body,created_at from support.message where thread_id=${id}::uuid order by created_at,id`.execute(
      db,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: iso(row.created_at),
  }));
}
export async function submitFeedback(
  db: SupportDb,
  ctx: LearnerContext,
  value: FeedbackInput,
): Promise<FeedbackThread> {
  const input = feedbackInputSchema.parse(value);
  const hash = fingerprint(input);
  return transaction(db, async (tx) => {
    await learnerLock(tx, ctx);
    const old = (
      await sql<ThreadRow>`select * from support.thread where user_id=${ctx.userId}::uuid and operation_key=${input.operationKey}`.execute(
        tx,
      )
    ).rows[0];
    if (old) {
      ensureHash(old.request_hash, hash);
      return { ...summary(old), context: old.context, messages: await messages(tx, old.id) };
    }
    const id = randomUUID();
    const row = (
      await sql<ThreadRow>`insert into support.thread(id,user_id,operation_key,request_hash,category,subject,email_notification,context) values(${id}::uuid,${ctx.userId}::uuid,${input.operationKey},${hash},${input.category},${input.subject},${input.emailNotification},${JSON.stringify(input.context ?? null)}::jsonb) returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw errors.conflict();
    await sql`insert into support.message(id,thread_id,author,actor_id,operation_key,request_hash,body) values(${randomUUID()}::uuid,${id}::uuid,'learner',${ctx.userId},${input.operationKey},${hash},${input.body})`.execute(
      tx,
    );
    return { ...summary(row), context: row.context, messages: await messages(tx, id) };
  });
}
export async function listFeedback(db: SupportDb, ctx: LearnerContext): Promise<FeedbackSummary[]> {
  await requireAccount(db, ctx.userId);
  const rows = (
    await sql<ThreadRow>`select * from support.thread where user_id=${ctx.userId}::uuid order by updated_at desc limit 200`.execute(
      db,
    )
  ).rows;
  return rows.map(summary);
}
export async function getFeedbackThread(
  db: SupportDb,
  ctx: LearnerContext,
  id: string,
): Promise<FeedbackThread> {
  return transaction(db, async (tx) => {
    const row = await threadRow(tx, id, true);
    if (row.user_id !== ctx.userId) throw errors.ownershipDenied();
    await sql`update support.thread set read_at=now() where id=${id}::uuid`.execute(tx);
    return {
      ...summary(row),
      unread: false,
      context: row.context,
      messages: await messages(tx, id),
    };
  });
}
const followupSchema = z.strictObject({
  operationKey: z.string().min(8).max(128),
  body: z.string().trim().min(1).max(10000),
  emailNotification: z.boolean().optional(),
});
export async function addFeedbackMessage(
  db: SupportDb,
  ctx: LearnerContext,
  id: string,
  value: z.infer<typeof followupSchema>,
): Promise<FeedbackThread> {
  const input = followupSchema.parse(value);
  const hash = fingerprint(input);
  return transaction(db, async (tx) => {
    await learnerLock(tx, ctx);
    const row = await threadRow(tx, id, true);
    if (row.user_id !== ctx.userId) throw errors.ownershipDenied();
    const old = (
      await sql<{
        request_hash: string;
      }>`select request_hash from support.message where thread_id=${id}::uuid and operation_key=${input.operationKey}`.execute(
        tx,
      )
    ).rows[0];
    if (old) ensureHash(old.request_hash, hash);
    else {
      await sql`insert into support.message(id,thread_id,author,actor_id,operation_key,request_hash,body) values(${randomUUID()}::uuid,${id}::uuid,'learner',${ctx.userId},${input.operationKey},${hash},${input.body})`.execute(
        tx,
      );
      await sql`update support.thread set status='awaiting_reply',updated_at=now(),email_notification=${input.emailNotification ?? row.email_notification} where id=${id}::uuid`.execute(
        tx,
      );
    }
    const current = await threadRow(tx, id);
    return { ...summary(current), context: current.context, messages: await messages(tx, id) };
  });
}
export async function listSupportInbox(
  db: SupportDb,
  ctx: AdminSupportContext,
  status?: FeedbackSummary["status"],
): Promise<FeedbackSummary[]> {
  requireActor(ctx);
  if (status) z.enum(["awaiting_reply", "replied", "closed"]).parse(status);
  const rows = (
    await sql<ThreadRow>`select * from support.thread ${status ? sql`where status=${status}` : sql``} order by updated_at desc limit 500`.execute(
      db,
    )
  ).rows;
  const active = new Map<string, Promise<boolean>>();
  for (const row of rows)
    if (!active.has(row.user_id)) active.set(row.user_id, accountExists(db, row.user_id));
  const visible = await Promise.all(
    rows.map(async (row) => ((await active.get(row.user_id)) ? summary(row) : null)),
  );
  return visible.filter((row): row is FeedbackSummary => row !== null);
}
export async function getSupportThread(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
): Promise<FeedbackThread> {
  requireActor(ctx);
  const row = await threadRow(db, id);
  return { ...summary(row), context: row.context, messages: await messages(db, id) };
}
export function routineReply(category: FeedbackInput["category"], locale: "en" | "fa"): string {
  const texts = {
    en: {
      question:
        "Thank you for your question. We are reviewing it. Could you share any additional details that would help us understand what you need?",
      problem:
        "Thank you for reporting this problem. We are reviewing the information you sent. Please tell us which step you were on and any error message you saw. Your class content is not needed.",
      suggestion:
        "Thank you for sharing your idea. We have recorded it for review. If you have an example of how you would use it, please share it here.",
      other:
        "Thank you for your message. We have received it and will review the details. You can add any further information here.",
    },
    fa: {
      question:
        "از پرسش شما سپاسگزاریم. در حال بررسی آن هستیم. اگر جزئیات دیگری برای توضیح نیازتان دارید، همین‌جا برایمان بفرستید.",
      problem:
        "از گزارش این مشکل سپاسگزاریم. اطلاعات ارسال‌شده را بررسی می‌کنیم. لطفاً مرحله‌ای که در آن بودید و متن خطایی را که دیدید بگویید. نیازی به ارسال محتوای کلاس نیست.",
      suggestion:
        "از پیشنهاد شما سپاسگزاریم. آن را برای بررسی ثبت کردیم. اگر نمونه‌ای از کاربرد این پیشنهاد دارید، همین‌جا برایمان بفرستید.",
      other:
        "از پیام شما سپاسگزاریم. آن را دریافت کرده‌ایم و جزئیات را بررسی می‌کنیم. اگر اطلاعات بیشتری دارید، همین‌جا اضافه کنید.",
    },
  };
  return texts[locale][category];
}
export async function createReplyDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: ReplyDraftInput,
): Promise<ReplyDraft> {
  requireActor(ctx);
  const input = replyDraftInputSchema.parse(value);
  const hash = fingerprint(input);
  return transaction(db, async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`support.reply:${ctx.actorId}:${input.operationKey}`}))`.execute(
      tx,
    );
    const thread = await threadRow(tx, input.threadId, true);
    const old = (
      await sql<ReplyRow>`select * from support.reply_draft where actor_id=${ctx.actorId} and operation_key=${input.operationKey}`.execute(
        tx,
      )
    ).rows[0];
    if (old) {
      ensureHash(old.request_hash, hash);
      return reply(old);
    }
    const body = input.body ?? routineReply(thread.category, input.language);
    const preview = makeReplyEmailPreview(thread, input.language, body, input);
    const row = (
      await sql<ReplyRow>`insert into support.reply_draft(id,thread_id,actor_id,operation_key,request_hash,body,language,source,email_preview) values(${randomUUID()}::uuid,${thread.id}::uuid,${ctx.actorId},${input.operationKey},${hash},${body},${input.language},${input.body ? "manual" : "routine"},${JSON.stringify(preview)}::jsonb) returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw errors.conflict();
    await audit(tx, ctx, "reply.draft", row.id, { threadId: thread.id });
    return reply(row);
  });
}
async function replyRow(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  lock = false,
): Promise<ReplyRow> {
  requireActor(ctx);
  const row = (
    await sql<ReplyRow>`select * from support.reply_draft where id=${z.uuid().parse(id)}::uuid ${lock ? sql`for update` : sql``}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw errors.notFound();
  if (row.actor_id !== ctx.actorId) throw errors.ownershipDenied();
  return row;
}
export async function getReplyDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
): Promise<ReplyDraft> {
  return reply(await replyRow(db, ctx, id));
}
export async function updateReplyDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  value: {
    revision: number;
    body: string;
    language: "en" | "fa";
    recipient?: EmailRecipient;
    appLink?: string;
    presentation?: EmailPresentationInput;
  },
): Promise<ReplyDraft> {
  const input = z
    .strictObject({
      revision: z.int().positive(),
      body: z.string().trim().min(1).max(10000),
      language: z.enum(["en", "fa"]),
      recipient: recipientSchema.optional(),
      appLink: z.string().max(2048).optional(),
      presentation: emailPresentationInputSchema.optional(),
    })
    .parse(value);
  return transaction(db, async (tx) => {
    const row = await replyRow(tx, ctx, id, true);
    if (row.state !== "draft" || row.revision !== input.revision) throw errors.conflict();
    const thread = await threadRow(tx, row.thread_id, true);
    const preview = makeReplyEmailPreview(thread, input.language, input.body, input);
    const saved = (
      await sql<ReplyRow>`update support.reply_draft set body=${input.body},language=${input.language},source='manual',email_preview=${JSON.stringify(preview)}::jsonb,revision=revision+1 where id=${id}::uuid returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!saved) throw errors.conflict();
    await audit(tx, ctx, "reply.edit", id, { revision: saved.revision });
    return reply(saved);
  });
}
export async function listReplyDrafts(
  db: SupportDb,
  ctx: AdminSupportContext,
  threadId: string,
): Promise<ReplyDraft[]> {
  requireActor(ctx);
  await threadRow(db, threadId);
  return (
    await sql<ReplyRow>`select * from support.reply_draft where thread_id=${threadId}::uuid and actor_id=${ctx.actorId} order by created_at desc`.execute(
      db,
    )
  ).rows.map(reply);
}
export async function approveReply(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: {
    draftId: string;
    revision: number;
    recipient?: EmailRecipient;
    appLink?: string;
    reason: string;
    notifyByEmail?: boolean;
    close?: boolean;
  },
): Promise<{ messageId: string; threadId: string; emailQueued: boolean }> {
  const input = z
    .object({
      draftId: z.uuid(),
      revision: z.int().positive(),
      reason: z.string().trim().min(1).max(1000),
      appLink: z.url().optional(),
      notifyByEmail: z.boolean().optional(),
      close: z.boolean().optional(),
    })
    .parse(value);
  return transaction(db, async (tx) => {
    const draft = await replyRow(tx, ctx, input.draftId, true);
    if (draft.revision !== input.revision) throw errors.conflict();
    const thread = await threadRow(tx, draft.thread_id, true);
    if (draft.state === "approved" && draft.approved_message_id) {
      const receipt = (
        await sql<{
          id: string;
        }>`select id from support.email_outbox where purpose_key=${`reply:${draft.id}`}`.execute(tx)
      ).rows[0];
      return { messageId: draft.approved_message_id, threadId: thread.id, emailQueued: !!receipt };
    }
    const notify = thread.email_notification && input.notifyByEmail !== false;
    const recipient = value.recipient;
    if (notify && (!recipient || recipient.userId !== thread.user_id))
      throw errors.validationFailed({ recipient: ["verified_account_email_required"] });
    const preview = draft.email_preview == null ? null : readReplyEmailPreview(draft.email_preview);
    if (preview && preview.presentation.language !== draft.language) throw errors.conflict();
    if (
      notify &&
      preview?.recipient &&
      (!recipient ||
        preview.recipient.userId !== recipient.userId ||
        preview.recipient.email.toLowerCase() !== recipient.email.toLowerCase())
    )
      throw errors.conflict();
    const id = randomUUID();
    await sql`insert into support.message(id,thread_id,author,actor_id,operation_key,request_hash,body) values(${id}::uuid,${thread.id}::uuid,'admin',${ctx.actorId},${`reply:${draft.id}`},${fingerprint({ body: draft.body, language: draft.language, revision: draft.revision })},${draft.body})`.execute(
      tx,
    );
    await sql`update support.thread set status=${input.close ? "closed" : "replied"},last_admin_at=now(),updated_at=now() where id=${thread.id}::uuid`.execute(
      tx,
    );
    if (notify && recipient) {
      const email = z.email().parse(recipient.email);
      const subject =
        preview?.subject ?? `${draft.language === "fa" ? "پاسخ: " : "Re: "}${thread.subject}`;
      const link = input.appLink ? `${input.appLink.replace(/\/$/, "")}/help/${thread.id}` : "";
      const body = preview?.body ?? draft.body + (link ? `\n\n${link}` : "");
      await sql`insert into support.email_outbox(id,thread_id,user_id,purpose_key,template_id,email,subject,body,language,presentation) values(${randomUUID()}::uuid,${thread.id}::uuid,${thread.user_id}::uuid,${`reply:${draft.id}`},'support_reply',${email},${subject},${body},${draft.language},${preview ? JSON.stringify(preview.presentation) : null}::jsonb) on conflict(purpose_key) do nothing`.execute(
        tx,
      );
    }
    await sql`update support.reply_draft set state='approved',approved_at=now(),approved_message_id=${id}::uuid where id=${draft.id}::uuid`.execute(
      tx,
    );
    await audit(tx, ctx, "reply.approve", draft.id, {
      revision: draft.revision,
      threadId: thread.id,
      emailNotification: notify,
      closed: input.close ?? false,
      reason: input.reason,
    });
    return { messageId: id, threadId: thread.id, emailQueued: notify };
  });
}
export async function setFeedbackStatus(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  status: "closed" | "awaiting_reply",
  reason: string,
): Promise<void> {
  requireActor(ctx);
  z.enum(["closed", "awaiting_reply"]).parse(status);
  z.string().min(1).max(1000).parse(reason);
  await transaction(db, async (tx) => {
    await threadRow(tx, id, true);
    await sql`update support.thread set status=${status},updated_at=now() where id=${id}::uuid`.execute(
      tx,
    );
    await audit(tx, ctx, "feedback.status", id, { status, reason });
  });
}
export async function purgeSupportUser(db: SupportDb, userId: string): Promise<void> {
  await sql`delete from support.email_outbox where user_id=${z.uuid().parse(userId)}::uuid`.execute(
    db,
  );
  await sql`delete from support.thread where user_id=${userId}::uuid`.execute(db);
  // Draft snapshots can contain several recipients; delete affected drafts rather than retaining deleted personal text.
  await sql`delete from support.email_draft where recipients @> ${JSON.stringify([{ userId }])}::jsonb`.execute(
    db,
  );
}
