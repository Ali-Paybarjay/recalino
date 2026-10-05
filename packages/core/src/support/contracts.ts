import { z } from "zod";

export type SupportLocale = "en" | "fa";
/** Construct only after the server owner guard; never from a client body. */
export interface AdminSupportContext {
  actorId: string;
}
export const templateIds = [
  "pilot_welcome",
  "pilot_invitation",
  "account_welcome",
  "feedback_thanks",
  "support_reply",
  "quota_updated",
  "pilot_followup",
  "pilot_complete",
  "service_notice",
] as const;
export type EmailTemplateId = (typeof templateIds)[number];
export interface EmailTemplate {
  id: EmailTemplateId;
  version: string;
  label: Record<SupportLocale, string>;
  content: Record<SupportLocale, { subject: string; body: string }>;
  requiredVariables: string[];
}
export const recipientSchema = z.strictObject({
  userId: z.uuid().nullable(),
  email: z.email().max(320),
  firstName: z.string().max(120).optional(),
  language: z.enum(["en", "fa"]).default("en"),
});
export type EmailRecipient = z.infer<typeof recipientSchema>;
export const emailDraftInputSchema = z.strictObject({
  operationKey: z.string().min(8).max(128),
  recipients: z.array(recipientSchema).min(1).max(1000),
  templateId: z.enum(templateIds).nullable(),
  language: z.enum(["en", "fa", "recipient"]),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  localizedContent: z
    .object({
      en: z
        .object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) })
        .optional(),
      fa: z
        .object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) })
        .optional(),
    })
    .optional(),
  variables: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), z.string().max(4000)).default({}),
  recipientVariables: z
    .record(z.string(), z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), z.string().max(4000)))
    .default({}),
  reason: z.string().trim().min(1).max(1000),
});
export type EmailDraftInput = z.input<typeof emailDraftInputSchema>;
export interface RenderedEmail {
  userId: string | null;
  email: string;
  language: SupportLocale;
  subject: string;
  body: string;
  missingVariables: string[];
}
export interface EmailDraft {
  draftId: string;
  revision: number;
  state: "draft" | "approved";
  templateId: EmailTemplateId | null;
  templateVersion: string;
  input: EmailDraftInput;
  recipients: RenderedEmail[];
  approvedAt: string | null;
  createdAt: string;
}
export type OutboxState = "queued" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
export interface OutboundEmail {
  id: string;
  draftId: string | null;
  userId: string | null;
  email: string;
  subject: string;
  body: string;
  language: SupportLocale;
  state: OutboxState;
  attempts: number;
  providerId: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  threadId: string | null;
}
export const feedbackInputSchema = z.strictObject({
  operationKey: z.string().min(8).max(128),
  category: z.enum(["question", "problem", "suggestion", "other"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  emailNotification: z.boolean(),
  context: z
    .strictObject({
      appVersion: z.string().max(80).optional(),
      screen: z.string().max(120).optional(),
    })
    .optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export interface FeedbackSummary {
  id: string;
  userId: string;
  category: FeedbackInput["category"];
  subject: string;
  status: "awaiting_reply" | "replied" | "closed";
  emailNotification: boolean;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
}
export interface FeedbackMessage {
  id: string;
  author: "learner" | "admin";
  body: string;
  createdAt: string;
}
export interface FeedbackThread extends FeedbackSummary {
  messages: FeedbackMessage[];
  context: FeedbackInput["context"] | null;
}
export interface ReplyDraft {
  id: string;
  threadId: string;
  revision: number;
  body: string;
  language: SupportLocale;
  state: "draft" | "approved";
  source: "routine" | "manual";
  approvedAt: string | null;
}
export const replyDraftInputSchema = z.strictObject({
  threadId: z.uuid(),
  body: z.string().trim().min(1).max(10000).optional(),
  language: z.enum(["en", "fa"]).default("en"),
  operationKey: z.string().min(8).max(128),
});
export type ReplyDraftInput = z.input<typeof replyDraftInputSchema>;
