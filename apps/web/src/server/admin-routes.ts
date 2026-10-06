import "server-only";
import { accountExists } from "@recalino/core/acc";
import { estimateRatesSchema, saveEstimateRates } from "@recalino/core/aip";
import {
  claimAdminRequest,
  readApprovedEmailResults,
  updateAdminPreferences,
  updateAdminTask,
} from "@recalino/core/ops";
import { errors, isValidIdempotencyKey } from "@recalino/core/plt";
import { retryRunAsAdmin } from "@recalino/core/proc";
import {
  amountsSchema,
  closeEntitlement,
  configureCostPolicy,
  configurePilot,
  costPolicySchema,
  grantAdminPilotEntitlement,
  pilotGrantOperationKey,
  readPilotConfiguration,
  setAllowanceAllocation,
} from "@recalino/core/quota";
import {
  approveEmailDraft,
  approveReply,
  createEmailDraft,
  createReplyDraft,
  type EmailDraftInput,
  type EmailPresentationSnapshot,
  type EmailRecipient,
  emailConfigStatus,
  emailPresentationInputSchema,
  emailPreviewHtml,
  getEmailDraft,
  getReplyDraft,
  getSupportThread,
  localizedEmailPresentationInputSchema,
  retryEmail,
  runEmailOutbox,
  saveEmailTemplate,
  setFeedbackStatus,
  templateIds,
} from "@recalino/core/support";
import { after } from "next/server";
import { z } from "zod";
import pilotDefaults from "../../../../config/pilot-defaults.json";
import type { AdminResult, AdminView, EmailPresentationPreview } from "../ui/admin/contracts";
import { readAdminSnapshot } from "./admin-data";
import { adminDirectory } from "./admin-directory";
import { adminEmailValues } from "./admin-email-values";
import { adminOperation } from "./admin-operation";
import { getAiProvider } from "./ai";
import type { Handler } from "./api";
import { runJobsSoon } from "./jobs";
import { getProcessingDefinition } from "./processing-jobs";

const locale = z.enum(["en", "fa"]);
const reasonSchema = z.string().trim().min(1).max(500);
const views = z.enum([
  "overview",
  "tasks",
  "users",
  "user",
  "pilot",
  "costs",
  "rates",
  "processing",
  "feedback",
  "thread",
  "templates",
  "history",
  "privacy",
  "backups",
  "audit",
  "settings",
]);
function presentationPreview(
  value: EmailPresentationSnapshot | null | undefined,
): EmailPresentationPreview | null {
  if (!value) return null;
  return {
    previewHtml: emailPreviewHtml(value),
    text: value.text,
    designVersion: value.designVersion,
    logoVersion: value.logoVersion,
    variant: value.variant,
    headline: value.headline,
    preheader: value.preheader,
    action: value.action,
  };
}
function key(request: Request) {
  const value = request.headers.get("idempotency-key");
  if (!value || !isValidIdempotencyKey(value))
    throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return value;
}
function dispatchSoon(db: Parameters<typeof runEmailOutbox>[0]) {
  after(async () => {
    await runEmailOutbox(db, {
      // Leave time within the route's 120-second budget; cron drains the remaining rows.
      limit: 5,
      resolveRecipientEmail: async (id) => (await adminDirectory().getUser(id)).email,
    });
  });
}
export function adminHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    // defineRoute verifies the Auth session and live owner membership before invoking this handler.
    if (!ctx.userId) throw errors.unauthenticated();
    const actorId = ctx.userId,
      actor = { actorId },
      directory = adminDirectory();
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const view: AdminView = views.parse(params.get("view") ?? "overview");
      const emailIds = params.get("emailIds");
      if (emailIds !== null) {
        if (view !== "history")
          throw errors.validationFailed({ emailIds: ["history_view_required"] });
        const ids = z.array(z.uuid()).min(1).max(50).parse(emailIds.split(","));
        return {
          body: { view, emails: await readApprovedEmailResults(db, [...new Set(ids)]) },
        };
      }
      const userId = params.get("userId") || undefined,
        threadId = params.get("threadId") || undefined;
      if (userId) z.uuid().parse(userId);
      if (threadId) z.uuid().parse(threadId);
      return {
        body: await readAdminSnapshot(
          db,
          {
            view,
            actorId,
            userId,
            threadId,
            search: params.get("search") ?? undefined,
            cursor: params.get("cursor") ?? undefined,
          },
          directory,
        ),
      };
    }
    const op = key(request);
    const envelope = z.strictObject({ action: z.string().min(1), input: z.unknown() }).parse(input);
    await claimAdminRequest(db, actorId, op, envelope);
    const value = envelope.input;
    switch (envelope.action) {
      case "pilot.configure": {
        const p = z
          .strictObject({ capacity: z.number().int().nonnegative().safe(), reason: reasonSchema })
          .parse(value);
        const current = await readPilotConfiguration(db, pilotDefaults.pilotId);
        await configurePilot(db, {
          pilotId: pilotDefaults.pilotId,
          version: `admin-${op}`,
          maximumParticipants: p.capacity,
          periodDays: current?.periodDays ?? pilotDefaults.periodDays,
          amounts: current?.amounts ?? pilotDefaults.amounts,
          operationKey: op,
          actorId,
          reason: p.reason,
        });
        return { body: { ok: true } };
      }
      case "pilot.grant": {
        const p = z
          .strictObject({
            userId: z.uuid(),
            amounts: amountsSchema,
            startsAt: z.iso.datetime(),
            periodDays: z.number().int().positive().safe(),
            reason: reasonSchema,
          })
          .parse(value);
        if (!(await readPilotConfiguration(db, pilotDefaults.pilotId)))
          await configurePilot(db, {
            ...pilotDefaults,
            operationKey: `admin-initialize-${pilotDefaults.pilotId}`,
            actorId,
            reason: "Initialize the previously approved pilot defaults",
          });
        const startsAt = new Date(p.startsAt),
          endsAt = new Date(startsAt.getTime() + p.periodDays * 86_400_000);
        if (!Number.isFinite(endsAt.getTime()))
          throw errors.validationFailed({ periodDays: ["invalid_period"] });
        const entitlementId = await grantAdminPilotEntitlement(db, {
          pilotId: pilotDefaults.pilotId,
          userId: p.userId,
          startsAt,
          endsAt,
          amounts: p.amounts,
          operationKey: pilotGrantOperationKey(pilotDefaults.pilotId, p.userId),
          actorId,
          reason: p.reason,
        });
        return { body: { ok: true, entitlementId } };
      }
      case "quota.set": {
        const p = z
          .strictObject({
            userId: z.uuid(),
            entitlementId: z.uuid(),
            amounts: amountsSchema,
            reason: reasonSchema,
          })
          .parse(value);
        return {
          body: {
            ok: true,
            ...(await setAllowanceAllocation(db, { ...p, operationKey: op, actorId })),
          },
        };
      }
      case "quota.close": {
        const p = z
          .strictObject({ userId: z.uuid(), entitlementId: z.uuid(), reason: reasonSchema })
          .parse(value);
        await closeEntitlement(db, { ...p, actorId });
        return { body: { ok: true } };
      }
      case "pricing.save": {
        const p = z.strictObject({ rates: estimateRatesSchema, reason: reasonSchema }).parse(value);
        return {
          body: { ok: true, ...(await saveEstimateRates(db, { ...p, operationKey: op, actorId })) },
        };
      }
      case "cost.configure": {
        const p = z
          .strictObject({
            limits: costPolicySchema.shape.limits,
            killSwitch: z.boolean(),
            reason: reasonSchema,
          })
          .parse(value);
        return {
          body: await adminOperation(
            db,
            actorId,
            op,
            p,
            "admin.cost_policy",
            p.reason,
            async (tx) => {
              await configureCostPolicy(
                tx,
                {
                  version: `admin-${op}`,
                  currency: "USD",
                  limits: p.limits,
                  killSwitch: p.killSwitch,
                },
                { actorId, reason: p.reason },
              );
              return { ok: true };
            },
          ),
        };
      }
      case "email.preview": {
        const content = z.strictObject({
          subject: z.string().trim().max(300),
          body: z.string().trim().max(20000),
        });
        const variables = z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), z.string().max(4000));
        const p = z
          .strictObject({
            userIds: z.array(z.uuid()).min(1).max(1000),
            templateId: z.enum(templateIds).nullable(),
            language: z.enum(["en", "fa", "recipient"]),
            subject: content.shape.subject.optional(),
            body: content.shape.body.optional(),
            localizedContent: z
              .strictObject({ en: content.optional(), fa: content.optional() })
              .optional(),
            localizedVariables: z
              .strictObject({ en: variables.optional(), fa: variables.optional() })
              .optional(),
            presentation: emailPresentationInputSchema.optional(),
            localizedPresentation: z
              .strictObject({
                en: localizedEmailPresentationInputSchema.optional(),
                fa: localizedEmailPresentationInputSchema.optional(),
              })
              .optional(),
            reason: reasonSchema.default("Prepare an email for owner review"),
          })
          .parse(value);
        const recipients: EmailRecipient[] = [],
          excluded: { userId: string; reason: string }[] = [];
        const recipientVariables: Record<string, Record<string, string>> = {};
        const config = emailConfigStatus();
        const unique = [...new Set(p.userIds)];
        for (let offset = 0; offset < unique.length; offset += 10) {
          const batch = await Promise.all(
            unique.slice(offset, offset + 10).map(async (userId) => {
              const account = await accountExists(db, userId);
              if (!account) {
                return { kind: "excluded", userId, reason: "account_unavailable" } as const;
              }
              const contact = await directory.getUser(userId);
              if (!contact.email) {
                return { kind: "excluded", userId, reason: "email_unavailable" } as const;
              }
              const language = p.language === "recipient" ? contact.language : p.language;
              const values = await adminEmailValues(
                db,
                userId,
                language,
                config.appLink,
                p.localizedVariables?.[language],
              );
              return {
                kind: "recipient",
                recipient: {
                  userId,
                  email: contact.email,
                  firstName: contact.name ?? undefined,
                  language: contact.language,
                },
                values,
              } as const;
            }),
          );
          for (const result of batch) {
            if (result.kind === "excluded")
              excluded.push({ userId: result.userId, reason: result.reason });
            else {
              recipients.push(result.recipient);
              recipientVariables[result.recipient.userId] = result.values;
            }
          }
        }
        if (!recipients.length)
          throw errors.validationFailed({ userIds: ["no_available_recipient"] });
        const draftInput: EmailDraftInput = {
          operationKey: op,
          recipients,
          templateId: p.templateId,
          language: p.language,
          subject: p.subject,
          body: p.body,
          localizedContent: p.localizedContent,
          presentation: p.presentation,
          localizedPresentation: p.localizedPresentation,
          variables: config.appLink ? { app_link: config.appLink } : {},
          recipientVariables,
          reason: p.reason,
        };
        // Validate before insertion while retaining the exact snapshot on an idempotent retry.
        const draft = await createEmailDraft(db, actor, draftInput, { requireResolved: true });
        const preview: AdminResult["preview"] = {
          previewId: `${draft.draftId}:${draft.revision}`,
          expiresAt: new Date(new Date(draft.createdAt).getTime() + 30 * 60_000).toISOString(),
          recipients: draft.recipients.map((r) => ({
            userId: r.userId ?? "",
            name: recipients.find((p) => p.userId === r.userId)?.firstName ?? null,
            email: r.email,
            language: r.language,
            subject: r.subject,
            body: r.body,
            presentation: presentationPreview(r.presentation),
          })),
          excluded,
        };
        return { body: { preview } };
      }
      case "email.send": {
        const p = z
          .object({
            previewId: z.string().regex(/^[0-9a-f-]{36}:\d+$/i),
            draftId: z.uuid().optional(),
            revision: z.number().int().positive().optional(),
          })
          .parse(value);
        const [draftId, revision] = p.previewId.split(":");
        if (!draftId || !revision)
          throw errors.validationFailed({ previewId: ["invalid_preview"] });
        if ((p.draftId && p.draftId !== draftId) || (p.revision && p.revision !== Number(revision)))
          throw errors.conflict();
        const draft = await getEmailDraft(db, actor, draftId);
        if (
          draft.state !== "approved" &&
          Date.now() > new Date(draft.createdAt).getTime() + 30 * 60_000
        )
          throw errors.validationFailed({ previewId: ["expired_preview"] });
        const result = await adminOperation(
          db,
          actorId,
          op,
          p,
          "admin.email_approve",
          "Owner approved the exact email snapshot",
          async (tx) => {
            const approved = await approveEmailDraft(tx, actor, {
              draftId,
              revision: Number(revision),
            });
            // Personal snapshots belong only to SUPPORT, where account deletion purges them.
            return { emailIds: approved.emails.map((email) => email.id) };
          },
        );
        dispatchSoon(db);
        return {
          status: 202,
          body: { ok: true, emails: await readApprovedEmailResults(db, result.emailIds) },
        };
      }
      case "email.retry": {
        const p = z
          .object({
            emailId: z.uuid().optional(),
            id: z.uuid().optional(),
            reason: reasonSchema.default("Retry a failed email"),
          })
          .parse(value);
        const id = p.emailId ?? p.id;
        if (!id) throw errors.validationFailed({ emailId: ["required"] });
        const result = await adminOperation(
          db,
          actorId,
          op,
          p,
          "admin.email_retry",
          p.reason,
          async (tx) => ({ emailIds: [(await retryEmail(tx, actor, id, p.reason)).id] }),
        );
        dispatchSoon(db);
        return {
          status: 202,
          body: { ok: true, emails: await readApprovedEmailResults(db, result.emailIds) },
        };
      }
      case "template.save": {
        const text = z.object({ en: z.string().min(1), fa: z.string().min(1) });
        const p = z
          .object({
            templateId: z.enum(templateIds),
            expectedVersion: z.string(),
            subject: text,
            body: text,
            presentation: z
              .strictObject({ en: emailPresentationInputSchema, fa: emailPresentationInputSchema })
              .optional(),
            reason: reasonSchema,
          })
          .parse(value);
        await saveEmailTemplate(db, actor, {
          id: p.templateId,
          expectedVersion: p.expectedVersion,
          content: {
            en: {
              subject: p.subject.en,
              body: p.body.en,
              ...(p.presentation?.en ? { presentation: p.presentation.en } : {}),
            },
            fa: {
              subject: p.subject.fa,
              body: p.body.fa,
              ...(p.presentation?.fa ? { presentation: p.presentation.fa } : {}),
            },
          },
          reason: p.reason,
        });
        return { body: { ok: true } };
      }
      case "feedback.suggest": {
        const p = z.strictObject({ threadId: z.uuid(), language: locale }).parse(value);
        const draft = await createReplyDraft(db, actor, { ...p, operationKey: op });
        return { body: { body: draft.body, source: "template" } };
      }
      case "feedback.preview": {
        const p = z
          .strictObject({
            threadId: z.uuid(),
            body: z.string().trim().min(1).max(10000),
            language: locale,
            notifyByEmail: z.boolean(),
            presentation: emailPresentationInputSchema.optional(),
          })
          .parse(value);
        const thread = await getSupportThread(db, actor, p.threadId),
          contact = await directory.getUser(thread.userId);
        if (p.notifyByEmail && !thread.emailNotification)
          throw errors.validationFailed({ notifyByEmail: ["learner_did_not_opt_in"] });
        if (p.notifyByEmail && !contact.email)
          throw errors.validationFailed({ recipient: ["email_unavailable"] });
        const recipient: EmailRecipient | undefined =
          p.notifyByEmail && contact.email
            ? {
                userId: thread.userId,
                email: contact.email,
                firstName: contact.name ?? undefined,
                language: p.language,
              }
            : undefined;
        const config = emailConfigStatus();
        const draft = await createReplyDraft(db, actor, {
          threadId: p.threadId,
          body: p.body,
          language: p.language,
          operationKey: op,
          ...(p.notifyByEmail
            ? {
                recipient,
                appLink: config.appLink ?? undefined,
                presentation: p.presentation,
              }
            : {}),
        });
        const replyPreview: AdminResult["replyPreview"] = {
          draftId: draft.id,
          revision: draft.revision,
          threadId: draft.threadId,
          language: draft.language,
          body: draft.body,
          emailPreview:
            p.notifyByEmail && draft.emailPreview && recipient
              ? {
                  email: recipient.email,
                  subject: draft.emailPreview.subject,
                  body: draft.emailPreview.body,
                  presentation: presentationPreview(draft.emailPreview.presentation),
                }
              : null,
        };
        return { body: { replyPreview } };
      }
      case "feedback.reply": {
        const p = z
          .strictObject({
            threadId: z.uuid(),
            draftId: z.uuid(),
            revision: z.int().positive(),
            notifyByEmail: z.boolean(),
            close: z.boolean().default(false),
          })
          .parse(value);
        const draft = await getReplyDraft(db, actor, p.draftId);
        if (draft.threadId !== p.threadId || draft.revision !== p.revision) throw errors.conflict();
        const thread = await getSupportThread(db, actor, p.threadId),
          contact = await directory.getUser(thread.userId);
        if (p.notifyByEmail && (!thread.emailNotification || !draft.emailPreview?.recipient))
          throw errors.validationFailed({ notifyByEmail: ["prepare_exact_email_preview"] });
        await adminOperation(
          db,
          actorId,
          op,
          p,
          "admin.reply_approve",
          "Owner approved this reply",
          async (tx) => {
            await approveReply(tx, actor, {
              draftId: draft.id,
              revision: draft.revision,
              notifyByEmail: p.notifyByEmail,
              close: p.close,
              recipient: contact.email
                ? {
                    userId: thread.userId,
                    email: contact.email,
                    firstName: contact.name ?? undefined,
                    language: draft.language,
                  }
                : undefined,
              reason: "Owner approved this reply",
            });
            return { ok: true };
          },
        );
        dispatchSoon(db);
        return { body: { ok: true } };
      }
      case "feedback.close": {
        const p = z
          .object({
            threadId: z.uuid(),
            closed: z.boolean().default(true),
            reason: reasonSchema.default("Status updated by the owner"),
          })
          .parse(value);
        return {
          body: await adminOperation(
            db,
            actorId,
            op,
            p,
            "admin.feedback_status",
            p.reason,
            async (tx) => {
              await setFeedbackStatus(
                tx,
                actor,
                p.threadId,
                p.closed ? "closed" : "awaiting_reply",
                p.reason,
              );
              return { ok: true };
            },
          ),
        };
      }
      case "job.retry": {
        const p = z
          .object({
            runId: z.uuid(),
            reason: reasonSchema.default("Operator reviewed the failed run"),
          })
          .parse(value);
        const job = getProcessingDefinition();
        if (!job) throw errors.validationFailed({ processing: ["storage_unavailable"] });
        const run = await retryRunAsAdmin(
          db,
          { ...p, actorId, requestId: ctx.requestId, operationKey: op },
          { provider: getAiProvider(), job },
        );
        if (run.state === "queued") runJobsSoon(["proc.process"], 90);
        return { status: 202, body: { ok: true } };
      }
      case "task.update": {
        const p = z
          .strictObject({
            taskId: z.string().min(1).max(300),
            state: z.enum(["open", "dismissed", "snoozed"]),
            snoozedUntil: z.iso.datetime().optional(),
            reason: reasonSchema,
          })
          .parse(value);
        return {
          body: await adminOperation(
            db,
            actorId,
            op,
            p,
            "admin.task_update",
            p.reason,
            async (tx) => {
              await updateAdminTask(tx, p);
              return { ok: true };
            },
          ),
        };
      }
      case "settings.save": {
        const p = z
          .strictObject({ language: locale, theme: z.enum(["system", "light", "dark"]) })
          .parse(value);
        return {
          body: await adminOperation(
            db,
            actorId,
            op,
            p,
            "admin.preferences",
            "Owner updated panel preferences",
            async (tx) => {
              await updateAdminPreferences(tx, { ...p, actorId });
              return { ok: true };
            },
          ),
        };
      }
      default:
        throw errors.validationFailed({ action: ["unsupported_action"] });
    }
  };
}
