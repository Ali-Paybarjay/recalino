import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { errors } from "../plt";
import {
  audit,
  ensureHash,
  fingerprint,
  iso,
  requireAccount,
  requireActor,
  type SupportDb,
  transaction,
} from "./common";
import {
  type AdminSupportContext,
  type EmailDraft,
  type EmailDraftInput,
  type EmailTemplate,
  type EmailTemplateId,
  emailDraftInputSchema,
  emailPresentationInputSchema,
  type OutboundEmail,
  type OutboxState,
  type RenderedEmail,
  templateIds,
} from "./contracts";
import {
  defaultEmailAction,
  renderEmailPresentation,
  safeEmailActionUrl,
  validateEmailPresentation,
} from "./presentation";
import { DEFAULT_EMAIL_TEMPLATES } from "./templates";

interface DraftRow {
  id: string;
  actor_id: string;
  revision: number;
  state: "draft" | "approved";
  template_id: EmailTemplateId | "freeform";
  template_version: string;
  input: EmailDraftInput;
  recipients: RenderedEmail[];
  approved_at: Date | null;
  created_at: Date;
  request_hash: string;
}
export interface OutboxRow {
  id: string;
  draft_id: string | null;
  thread_id: string | null;
  user_id: string | null;
  purpose_key: string;
  template_id: string;
  email: string;
  subject: string;
  body: string;
  language: "en" | "fa";
  state: OutboxState;
  attempts: number;
  provider_id: string | null;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Date;
  attempted_at: Date | null;
  presentation?: unknown;
}
function draft(row: DraftRow): EmailDraft {
  return {
    draftId: row.id,
    revision: row.revision,
    state: row.state,
    templateId: row.template_id === "freeform" ? null : row.template_id,
    templateVersion: row.template_version,
    input: row.input,
    recipients: row.recipients.map((recipient) => ({
      ...recipient,
      ...(recipient.presentation
        ? { presentation: validateEmailPresentation(recipient.presentation) }
        : {}),
    })),
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    createdAt: iso(row.created_at),
  };
}
export function outbound(row: OutboxRow): OutboundEmail {
  return {
    id: row.id,
    draftId: row.draft_id,
    threadId: row.thread_id,
    userId: row.user_id,
    email: row.email,
    subject: row.subject,
    body: row.body,
    language: row.language,
    state: row.state,
    attempts: row.attempts,
    providerId: row.provider_id,
    lastError: row.last_error,
    sentAt: row.sent_at ? iso(row.sent_at) : null,
    createdAt: iso(row.created_at),
    presentation: row.presentation == null ? null : validateEmailPresentation(row.presentation),
  };
}
export async function listEmailTemplates(db?: SupportDb): Promise<EmailTemplate[]> {
  if (!db) return structuredClone(DEFAULT_EMAIL_TEMPLATES);
  const rows = (
    await sql<{
      template_id: EmailTemplateId;
      revision: number;
      content: EmailTemplate["content"];
    }>`select distinct on(template_id) template_id,revision,content from support.template_revision order by template_id,revision desc`.execute(
      db,
    )
  ).rows;
  return DEFAULT_EMAIL_TEMPLATES.map((base) => {
    const revision = rows.find((row) => row.template_id === base.id);
    return revision
      ? { ...base, version: `custom:${revision.revision}`, content: revision.content }
      : structuredClone(base);
  });
}
export async function saveEmailTemplate(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: {
    id: EmailTemplateId;
    expectedVersion: string;
    content: EmailTemplate["content"];
    reason: string;
  },
): Promise<EmailTemplate> {
  requireActor(ctx);
  const input = z
    .strictObject({
      id: z.enum(templateIds),
      expectedVersion: z.string().min(1),
      content: z.strictObject({
        en: z.strictObject({
          subject: z.string().trim().min(1).max(300),
          body: z.string().trim().min(1).max(20000),
          presentation: emailPresentationInputSchema.optional(),
        }),
        fa: z.strictObject({
          subject: z.string().trim().min(1).max(300),
          body: z.string().trim().min(1).max(20000),
          presentation: emailPresentationInputSchema.optional(),
        }),
      }),
      reason: z.string().trim().min(1).max(1000),
    })
    .parse(value);
  return transaction(db, async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`support.template:${input.id}`}))`.execute(
      tx,
    );
    const current = (await listEmailTemplates(tx)).find((item) => item.id === input.id);
    if (!current || current.version !== input.expectedVersion) throw errors.conflict();
    const revision = current.version.startsWith("custom:")
      ? Number(current.version.slice(7)) + 1
      : 1;
    await sql`insert into support.template_revision(template_id,revision,content,actor_id) values(${input.id},${revision},${JSON.stringify(input.content)}::jsonb,${ctx.actorId})`.execute(
      tx,
    );
    await audit(tx, ctx, "template.save", input.id, { revision, reason: input.reason });
    return { ...current, version: `custom:${revision}`, content: input.content };
  });
}
/** Plain text substitution and escaped presentation only. Recipient identity remains trusted. */
export function renderEmailRecipients(
  value: EmailDraftInput,
  template: Omit<EmailTemplate, "id"> & { id: EmailTemplateId | null },
): RenderedEmail[] {
  const input = emailDraftInputSchema.parse(value);
  const seen = new Set<string>();
  return input.recipients.map((recipient) => {
    const identity = recipient.email.toLowerCase();
    if (seen.has(identity)) throw errors.validationFailed({ recipients: ["duplicate_email"] });
    seen.add(identity);
    if (!recipient.userId && template.id !== "pilot_invitation")
      throw errors.validationFailed({ recipients: ["account_required"] });
    const locale = input.language === "recipient" ? recipient.language : input.language;
    const localized = input.localizedContent?.[locale];
    const content = localized ?? template.content[locale];
    // A partial localized edit leaves other recipients on the verified template translation.
    const override =
      input.language === "recipient" ? !input.localizedContent && locale === "en" : true;
    const subject = localized
      ? localized.subject
      : override
        ? (input.subject ?? content.subject)
        : content.subject;
    const body = localized
      ? localized.body
      : override
        ? (input.body ?? content.body)
        : content.body;
    const defaults = template.variableDefaults?.[locale] ?? {};
    const manualVariables = {
      ...input.variables,
      ...input.recipientVariables[recipient.userId ?? recipient.email],
    };
    // Clearing optional routine prose restores its visible default; actual custom data stays required.
    const variables = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(manualVariables).filter(
          ([key, value]) => !Object.hasOwn(defaults, key) || value.trim(),
        ),
      ),
      first_name: recipient.firstName?.trim() || (locale === "fa" ? "دوست عزیز" : "there"),
      account_email: recipient.email,
    };
    const missing = new Set<string>();
    const substitute = (text: string) =>
      text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
        if (
          !/^[a-z_][a-z0-9_]*$/.test(key) ||
          !Object.hasOwn(variables, key) ||
          !String(variables[key as keyof typeof variables]).trim()
        ) {
          missing.add(key);
          return `{{${key}}}`;
        }
        return String(variables[key as keyof typeof variables]);
      });
    const renderedSubject = substitute(subject);
    const renderedBody = substitute(body);
    if (!renderedSubject.trim())
      throw errors.validationFailed({ [`localizedContent.${locale}.subject`]: ["required"] });
    if (!renderedBody.trim())
      throw errors.validationFailed({ [`localizedContent.${locale}.body`]: ["required"] });
    if (/[\r\n]/.test(renderedSubject))
      throw errors.validationFailed({ subject: ["single_line_required"] });
    if (renderedSubject.length > 300 || renderedBody.length > 24000)
      throw errors.validationFailed({ body: ["rendered_text_too_long"] });
    const sourcePresentation =
      input.localizedPresentation?.[locale] ??
      (input.language === "recipient" && (input.localizedPresentation || input.localizedContent)
        ? undefined
        : input.presentation) ??
      content.presentation;
    const visual = {
      ...(sourcePresentation?.headline
        ? { headline: substitute(sourcePresentation.headline) }
        : {}),
      ...(sourcePresentation?.preheader !== undefined
        ? { preheader: substitute(sourcePresentation.preheader) }
        : {}),
      action:
        sourcePresentation?.action === null
          ? null
          : sourcePresentation?.action
            ? {
                label: substitute(sourcePresentation.action.label),
                url: substitute(sourcePresentation.action.url),
              }
            : defaultEmailAction(template.id, locale, variables),
    };
    // Unresolved tokens remain visible in the draft; no unresolved URL can become an active link.
    if (visual.action && /\{\{/.test(visual.action.url)) visual.action = null;
    const visualValidation = emailPresentationInputSchema.safeParse(visual);
    if (!visualValidation.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of visualValidation.error.issues)
        fields[`localizedPresentation.${locale}.${issue.path.join(".")}`] = [issue.code];
      throw errors.validationFailed(fields);
    }
    if (visual.action) {
      try {
        visual.action.url = safeEmailActionUrl(visual.action.url);
      } catch {
        throw errors.validationFailed({
          [`localizedPresentation.${locale}.action.url`]: ["https_action_url_required"],
        });
      }
    }
    const presentation = renderEmailPresentation({
      language: locale,
      subject: renderedSubject,
      body: renderedBody,
      templateId: template.id,
      presentation: visual,
    });
    return {
      userId: recipient.userId,
      email: recipient.email,
      language: locale,
      subject: renderedSubject,
      body: renderedBody,
      missingVariables: [...missing].sort(),
      presentation,
    };
  });
}
function previewJson(previews: RenderedEmail[]): string {
  const value = JSON.stringify(previews);
  if (Buffer.byteLength(value, "utf8") > 12 * 1024 * 1024)
    throw errors.validationFailed({ recipients: ["preview_batch_too_large"] });
  return value;
}
function requireResolved(previews: RenderedEmail[]): void {
  const fields: Record<string, string[]> = {};
  for (const recipient of previews)
    for (const name of recipient.missingVariables)
      fields[
        /^[a-z_][a-z0-9_]*$/.test(name)
          ? `localizedVariables.${recipient.language}.${name}`
          : "body"
      ] = ["required_template_variable"];
  if (Object.keys(fields).length) throw errors.validationFailed(fields);
}
async function resolveTemplate(
  db: SupportDb,
  input: EmailDraftInput,
): Promise<Omit<EmailTemplate, "id"> & { id: EmailTemplateId | null }> {
  if (input.templateId === null)
    return {
      id: null,
      version: "custom",
      label: { en: "Custom email", fa: "ایمیل آزاد" },
      content: { en: { subject: "", body: "" }, fa: { subject: "", body: "" } },
      requiredVariables: [],
    };
  const template = (await listEmailTemplates(db)).find((item) => item.id === input.templateId);
  if (!template) throw errors.notFound();
  return template;
}
export async function createEmailDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: EmailDraftInput,
  options: { requireResolved?: boolean } = {},
): Promise<EmailDraft> {
  requireActor(ctx);
  const input = emailDraftInputSchema.parse(value);
  const hash = fingerprint(input);
  return transaction(db, async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`support.draft:${ctx.actorId}:${input.operationKey}`}))`.execute(
      tx,
    );
    const old = (
      await sql<DraftRow>`select * from support.email_draft where actor_id=${ctx.actorId} and operation_key=${input.operationKey}`.execute(
        tx,
      )
    ).rows[0];
    if (old) {
      ensureHash(old.request_hash, hash);
      if (options.requireResolved) requireResolved(old.recipients);
      return draft(old);
    }
    const template = await resolveTemplate(tx, input);
    for (const recipient of input.recipients)
      if (recipient.userId) await requireAccount(tx, recipient.userId);
    const previews = renderEmailRecipients(input, template);
    if (options.requireResolved) requireResolved(previews);
    const saved = (
      await sql<DraftRow>`insert into support.email_draft(id,actor_id,operation_key,request_hash,template_id,template_version,input,recipients) values(${randomUUID()}::uuid,${ctx.actorId},${input.operationKey},${hash},${template.id ?? "freeform"},${template.version},${JSON.stringify(input)}::jsonb,${previewJson(previews)}::jsonb) returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!saved) throw errors.conflict();
    await audit(tx, ctx, "email.draft", saved.id, {
      recipientCount: previews.length,
      reason: input.reason,
    });
    return draft(saved);
  });
}
async function draftRow(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  lock = false,
): Promise<DraftRow> {
  requireActor(ctx);
  const row = (
    await sql<DraftRow>`select * from support.email_draft where id=${z.uuid().parse(id)}::uuid ${lock ? sql`for update` : sql``}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw errors.notFound();
  if (row.actor_id !== ctx.actorId) throw errors.ownershipDenied();
  return row;
}
export async function getEmailDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
): Promise<EmailDraft> {
  return draft(await draftRow(db, ctx, id));
}
export async function listEmailDrafts(
  db: SupportDb,
  ctx: AdminSupportContext,
): Promise<EmailDraft[]> {
  requireActor(ctx);
  return (
    await sql<DraftRow>`select * from support.email_draft where actor_id=${ctx.actorId} order by created_at desc limit 100`.execute(
      db,
    )
  ).rows.map(draft);
}
export async function updateEmailDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  revision: number,
  value: EmailDraftInput,
): Promise<EmailDraft> {
  const input = emailDraftInputSchema.parse(value);
  z.int().positive().parse(revision);
  return transaction(db, async (tx) => {
    const current = await draftRow(tx, ctx, id, true);
    if (current.state !== "draft" || current.revision !== revision) throw errors.conflict();
    const template = await resolveTemplate(tx, input);
    for (const recipient of input.recipients)
      if (recipient.userId) await requireAccount(tx, recipient.userId);
    const previews = renderEmailRecipients(input, template);
    const saved = (
      await sql<DraftRow>`update support.email_draft set revision=revision+1,input=${JSON.stringify(input)}::jsonb,recipients=${previewJson(previews)}::jsonb,template_id=${template.id ?? "freeform"},template_version=${template.version} where id=${id}::uuid returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!saved) throw errors.conflict();
    await audit(tx, ctx, "email.edit", id, {
      revision: saved.revision,
      recipientCount: previews.length,
      reason: input.reason,
    });
    return draft(saved);
  });
}
export async function approveEmailDraft(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: { draftId: string; revision: number },
): Promise<{ draftId: string; revision: number; emails: OutboundEmail[] }> {
  const input = z.strictObject({ draftId: z.uuid(), revision: z.int().positive() }).parse(value);
  return transaction(db, async (tx) => {
    const current = await draftRow(tx, ctx, input.draftId, true);
    if (current.revision !== input.revision) throw errors.conflict();
    const purposes = current.recipients.map((recipient) =>
      current.template_id === "pilot_welcome" && recipient.userId
        ? `welcome:${current.input.variables?.pilot_id ?? "current"}:${recipient.userId}`
        : `draft:${current.id}:${recipient.email.toLowerCase()}`,
    );
    if (current.state === "approved") {
      const receipt = (
        await sql<{
          email_ids: unknown;
        }>`select detail->'emailIds' as email_ids from support.activity where actor_id=${ctx.actorId} and action='email.approve' and resource_id=${current.id} order by id desc limit 1`.execute(
          tx,
        )
      ).rows[0];
      const ids = receipt?.email_ids ? z.array(z.uuid()).parse(receipt.email_ids) : null;
      // Legacy approvals used only the original canonical purpose; new approvals retain their exact row IDs.
      const emails = (
        await sql<OutboxRow>`select * from support.email_outbox where ${ids ? sql`id=any(${ids}::uuid[])` : sql`purpose_key=any(${purposes}::text[])`} order by created_at,id`.execute(
          tx,
        )
      ).rows.map(outbound);
      return {
        draftId: current.id,
        revision: current.revision,
        emails,
      };
    }
    if (current.recipients.some((recipient) => recipient.missingVariables.length))
      throw errors.validationFailed({ variables: ["unresolved_variables"] });
    for (const recipient of current.recipients) {
      if (recipient.presentation) {
        const snapshot = validateEmailPresentation(recipient.presentation);
        if (snapshot.body !== recipient.body || snapshot.language !== recipient.language)
          throw errors.conflict();
      }
    }
    // Stable ordering prevents competing multi-recipient welcome approvals from deadlocking.
    if (current.template_id === "pilot_welcome")
      for (const purpose of [...purposes].sort())
        await sql`select pg_advisory_xact_lock(hashtext(${`support.welcome:${purpose}`}))`.execute(
          tx,
        );
    const emails: OutboundEmail[] = [];
    for (const recipient of current.recipients) {
      if (recipient.userId) await requireAccount(tx, recipient.userId);
      let purpose =
        current.template_id === "pilot_welcome" && recipient.userId
          ? `welcome:${current.input.variables?.pilot_id ?? "current"}:${recipient.userId}`
          : `draft:${current.id}:${recipient.email.toLowerCase()}`;
      if (current.template_id === "pilot_welcome" && recipient.userId) {
        const prefix = `${purpose}:replacement:`;
        const previous = (
          await sql<OutboxRow>`select * from support.email_outbox where user_id=${recipient.userId}::uuid and template_id='pilot_welcome' and (purpose_key=${purpose} or left(purpose_key,length(${prefix}))=${prefix}) order by (state='sent') desc,created_at desc,id desc for update`.execute(
            tx,
          )
        ).rows;
        const active = previous.find((row) => row.state !== "cancelled");
        if (active) {
          emails.push(outbound(active));
          continue;
        }
        // A cancelled message was never sent. Keep its old snapshot and key intact, and require this new approval.
        if (previous[0]) purpose = `${prefix}${previous[0].id}`;
      }
      const saved = (
        await sql<OutboxRow>`insert into support.email_outbox(id,draft_id,user_id,purpose_key,template_id,email,subject,body,language,presentation) values(${randomUUID()}::uuid,${current.id}::uuid,${recipient.userId}::uuid,${purpose},${current.template_id},${recipient.email},${recipient.subject},${recipient.body},${recipient.language},${recipient.presentation ? JSON.stringify(recipient.presentation) : null}::jsonb) returning *`.execute(
          tx,
        )
      ).rows[0];
      if (!saved) throw errors.conflict();
      emails.push(outbound(saved));
    }
    await sql`update support.email_draft set state='approved',approved_at=now() where id=${current.id}::uuid`.execute(
      tx,
    );
    await audit(tx, ctx, "email.approve", current.id, {
      revision: current.revision,
      recipientCount: current.recipients.length,
      emailIds: emails.map((email) => email.id),
      reason: current.input.reason,
    });
    return {
      draftId: current.id,
      revision: current.revision,
      emails,
    };
  });
}
export async function listEmails(
  db: SupportDb,
  ctx: AdminSupportContext,
  filter: { draftId?: string; userId?: string; state?: OutboxState } = {},
): Promise<OutboundEmail[]> {
  requireActor(ctx);
  if (filter.draftId) z.uuid().parse(filter.draftId);
  if (filter.userId) z.uuid().parse(filter.userId);
  const rows = (
    await sql<OutboxRow>`select * from support.email_outbox where true ${filter.draftId ? sql`and draft_id=${filter.draftId}::uuid` : sql``} ${filter.userId ? sql`and user_id=${filter.userId}::uuid` : sql``} ${filter.state ? sql`and state=${filter.state}` : sql``} order by created_at desc limit 1000`.execute(
      db,
    )
  ).rows;
  return rows.map(outbound);
}
export async function retryEmail(
  db: SupportDb,
  ctx: AdminSupportContext,
  id: string,
  reason: string,
): Promise<OutboundEmail> {
  requireActor(ctx);
  z.string().trim().min(1).max(1000).parse(reason);
  return transaction(db, async (tx) => {
    const row = (
      await sql<OutboxRow>`select * from support.email_outbox where id=${z.uuid().parse(id)}::uuid for update`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw errors.notFound();
    // Unknown results must be reconciled; never create a fresh duplicate send to guess the outcome.
    if (row.state !== "failed")
      throw errors.validationFailed({ state: ["only_confirmed_failures_can_retry"] });
    if (row.user_id) await requireAccount(tx, row.user_id);
    const saved = (
      await sql<OutboxRow>`update support.email_outbox set state='queued',last_error=null where id=${id}::uuid returning *`.execute(
        tx,
      )
    ).rows[0];
    if (!saved) throw errors.conflict();
    await audit(tx, ctx, "email.retry", id, { reason });
    return outbound(saved);
  });
}
export async function reconcileEmail(
  db: SupportDb,
  ctx: AdminSupportContext,
  value: { id: string; state: "sent" | "failed"; providerId?: string; reason: string },
): Promise<void> {
  requireActor(ctx);
  const input = z
    .strictObject({
      id: z.uuid(),
      state: z.enum(["sent", "failed"]),
      providerId: z.string().min(1).max(200).optional(),
      reason: z.string().trim().min(10).max(1000),
    })
    .parse(value);
  if (input.state === "sent" && !input.providerId)
    throw errors.validationFailed({ providerId: ["verified_provider_reference_required"] });
  await transaction(db, async (tx) => {
    const row = (
      await sql<OutboxRow>`select * from support.email_outbox where id=${input.id}::uuid for update`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw errors.notFound();
    if (row.state !== "unknown") throw errors.conflict();
    await sql`update support.email_outbox set state=${input.state},provider_id=${input.providerId ?? null},sent_at=${input.state === "sent" ? new Date() : null},last_error=${input.state === "failed" ? "reconciled_rejected" : null} where id=${input.id}::uuid`.execute(
      tx,
    );
    await audit(tx, ctx, "email.reconcile", input.id, {
      state: input.state,
      providerId: input.providerId ?? null,
      reason: input.reason,
    });
  });
}
