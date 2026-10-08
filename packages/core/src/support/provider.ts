import { createHash } from "node:crypto";
import { sql } from "kysely";
import { createTransport } from "nodemailer";
import type { SendMailOptions } from "nodemailer/lib/mailer";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import { z } from "zod";
import { accountExists } from "../acc";
import { type SupportDb, transaction } from "./common";
import type { OutboundEmail } from "./contracts";
import { type OutboxRow, outbound } from "./email";
import { getEmailLogo } from "./email-logo";
import { validateEmailPresentation } from "./presentation";

export interface EmailProvider {
  send(
    message: OutboundEmail,
    idempotencyKey: string,
  ): Promise<
    { state: "sent"; providerId: string } | { state: "failed" | "unknown"; error: string }
  >;
}
export interface EmailConfiguration {
  provider: "resend" | "gmail";
  from: string;
  replyTo?: string;
  appLink: string;
}
export interface GmailEmailConfiguration extends EmailConfiguration {
  provider: "gmail";
  user: string;
  appPassword: string;
}
export interface GmailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
  close(): void;
}
export type GmailTransportFactory = (options: SMTPTransportOptions) => GmailTransport;

/** Read only the approved content; presentation changes never re-render an existing outbox row. */
function frozenEmailContent(message: OutboundEmail): {
  text: string;
  html?: string;
  logo?: ReturnType<typeof getEmailLogo>;
} {
  if (message.presentation == null) return { text: message.body };
  const snapshot = validateEmailPresentation(message.presentation);
  if (snapshot.language !== message.language || snapshot.body !== message.body)
    throw new Error("email_presentation_invalid");
  return { text: snapshot.text, html: snapshot.html, logo: getEmailLogo(snapshot.logoVersion) };
}

function hasHeaderControls(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
const mailboxSchema = z.email().max(320);
function parseMailbox(value: string | undefined): { address: string; name?: string } | null {
  if (!value || value.length > 500 || hasHeaderControls(value)) return null;
  const raw = value.trim();
  if (mailboxSchema.safeParse(raw).success) return { address: raw };
  const match = /^([^<>]+)<([^<>]+)>$/.exec(raw);
  const address = match?.[2]?.trim();
  const name = match?.[1]?.trim().replace(/^"(.*)"$/, "$1");
  return address && name && mailboxSchema.safeParse(address).success ? { address, name } : null;
}
function gmailUser(value: string | undefined): string | null {
  const raw = value?.trim().toLowerCase();
  return raw && mailboxSchema.safeParse(raw).success && /@(gmail|googlemail)\.com$/.test(raw)
    ? raw
    : null;
}
function gmailPassword(value: string | undefined): string | null {
  // Google displays app passwords in four space-separated groups. Reject other whitespace.
  const password = value?.replace(/ /g, "");
  return password && /^[a-zA-Z0-9]{16}$/.test(password) ? password : null;
}
function validAppLink(value: string | undefined): boolean {
  if (!value || hasHeaderControls(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
export function emailConfigStatus(env: Record<string, string | undefined> = process.env): {
  configured: boolean;
  provider: "resend" | "gmail" | null;
  sender: string | null;
  replyTo: string | null;
  appLink: string | null;
  missing: string[];
} {
  const missing: string[] = [];
  const selected = env.RECALINO_EMAIL_PROVIDER?.trim() ?? "resend";
  const provider = selected === "resend" || selected === "gmail" ? selected : null;
  const from = parseMailbox(env.RECALINO_EMAIL_FROM);
  const replyTo = parseMailbox(env.RECALINO_EMAIL_REPLY_TO);
  if (!provider) missing.push("RECALINO_EMAIL_PROVIDER");
  if (provider === "resend" && !env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (provider === "gmail") {
    const user = gmailUser(env.RECALINO_GMAIL_USER);
    if (!user) missing.push("RECALINO_GMAIL_USER");
    if (!gmailPassword(env.RECALINO_GMAIL_APP_PASSWORD))
      missing.push("RECALINO_GMAIL_APP_PASSWORD");
    if (from && user && from.address.toLowerCase() !== user) missing.push("RECALINO_EMAIL_FROM");
  }
  if (!from) missing.push("RECALINO_EMAIL_FROM");
  if (env.RECALINO_EMAIL_REPLY_TO?.trim() && !replyTo) missing.push("RECALINO_EMAIL_REPLY_TO");
  if (!validAppLink(env.RECALINO_PUBLIC_APP_URL)) missing.push("RECALINO_PUBLIC_APP_URL");
  return {
    configured: missing.length === 0,
    provider,
    sender: missing.includes("RECALINO_EMAIL_FROM")
      ? null
      : (env.RECALINO_EMAIL_FROM?.trim() ?? null),
    replyTo: replyTo ? (env.RECALINO_EMAIL_REPLY_TO?.trim() ?? null) : null,
    appLink: missing.includes("RECALINO_PUBLIC_APP_URL")
      ? null
      : (env.RECALINO_PUBLIC_APP_URL ?? null),
    missing,
  };
}

const smtpReceiptSchema = z.object({
  accepted: z.array(z.union([z.string(), z.object({ address: z.string() })])),
  rejected: z.array(z.unknown()),
  pending: z.array(z.unknown()).optional(),
  response: z.string(),
  messageId: z.string(),
});
function smtpFailure(error: unknown): Awaited<ReturnType<EmailProvider["send"]>> {
  // Never persist raw SMTP responses: they may echo message content or credentials.
  const detail = z
    .object({
      code: z.string().optional(),
      command: z.string().optional(),
      responseCode: z.number().optional(),
    })
    .safeParse(error);
  if (detail.success) {
    const { code, command, responseCode } = detail.data;
    const rejected = responseCode !== undefined && responseCode >= 400 && responseCode <= 599;
    if (code === "EAUTH" && command?.startsWith("AUTH") && rejected)
      return { state: "failed", error: "smtp_authentication_rejected" };
    if (code === "EENVELOPE" && /^(MAIL FROM|RCPT TO)$/.test(command ?? "") && rejected)
      return { state: "failed", error: "smtp_envelope_rejected" };
  }
  return { state: "unknown", error: "smtp_result_unverified" };
}

/** Gmail has no idempotency API; ambiguous results require reconciliation, never automatic retry. */
export function createGmailProvider(
  config: GmailEmailConfiguration,
  transportFactory: GmailTransportFactory = (options) => createTransport(options),
): EmailProvider {
  const user = gmailUser(config.user);
  const password = gmailPassword(config.appPassword);
  const from = parseMailbox(config.from);
  const replyTo = parseMailbox(config.replyTo);
  if (
    !user ||
    !password ||
    !from ||
    from.address.toLowerCase() !== user ||
    (config.replyTo && !replyTo) ||
    !validAppLink(config.appLink)
  )
    throw new Error("invalid_gmail_configuration");
  return {
    async send(message, key) {
      const recipient = mailboxSchema.safeParse(message.email);
      if (
        !recipient.success ||
        hasHeaderControls(message.subject) ||
        !message.subject.trim() ||
        message.subject.length > 300 ||
        !message.body.trim() ||
        message.body.length > 24000 ||
        message.body.includes("\0") ||
        !key
      )
        return { state: "failed", error: "smtp_message_invalid" };
      let content: ReturnType<typeof frozenEmailContent>;
      try {
        content = frozenEmailContent(message);
      } catch {
        return { state: "failed", error: "email_presentation_invalid" };
      }
      const messageId = `<recalino.${createHash("sha256").update(key).digest("hex")}@${user.split("@")[1]}>`;
      let transport: GmailTransport;
      try {
        transport = transportFactory({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          forceAuth: true,
          auth: { user, pass: password },
          tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: "smtp.gmail.com" },
          dnsTimeout: 5000,
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
          logger: false,
          debug: false,
          transactionLog: false,
          disableFileAccess: true,
          disableUrlAccess: true,
          maxRecipients: 1,
        });
      } catch {
        return { state: "failed", error: "smtp_initialization_failed" };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<Awaited<ReturnType<EmailProvider["send"]>>>((resolve) => {
          timer = setTimeout(
            () => resolve({ state: "unknown", error: "smtp_result_unverified" }),
            15000,
          );
        });
        const sending = transport
          .sendMail({
            from: { ...from, address: user },
            to: { address: recipient.data },
            envelope: { from: user, to: [recipient.data] },
            ...(replyTo ? { replyTo } : {}),
            subject: message.subject,
            text: content.text,
            ...(content.html && content.logo
              ? {
                  html: content.html,
                  encoding: "base64",
                  attachments: [
                    {
                      filename: content.logo.filename,
                      content: Buffer.from(content.logo.contentBase64, "base64"),
                      contentType: content.logo.contentType,
                      contentDisposition: "inline",
                      cid: content.logo.cid,
                    },
                  ],
                }
              : {}),
            textEncoding: "base64",
            messageId,
            disableFileAccess: true,
            disableUrlAccess: true,
          })
          .then((receipt): Awaited<ReturnType<EmailProvider["send"]>> => {
            const parsed = smtpReceiptSchema.safeParse(receipt);
            if (parsed.success) {
              const info = parsed.data;
              const accepted = info.accepted[0];
              const address = typeof accepted === "string" ? accepted : accepted?.address;
              if (
                info.accepted.length === 1 &&
                address?.toLowerCase() === recipient.data.toLowerCase() &&
                info.rejected.length === 0 &&
                !info.pending?.length &&
                /^2\d\d\b/.test(info.response) &&
                info.messageId === messageId
              )
                return { state: "sent", providerId: messageId };
            }
            return { state: "unknown", error: "smtp_response_unverified" };
          })
          .catch(smtpFailure);
        return await Promise.race([sending, timeout]);
      } catch (error) {
        return smtpFailure(error);
      } finally {
        clearTimeout(timer);
        try {
          transport.close();
        } catch {
          // A cleanup failure cannot change an already verified SMTP result.
        }
      }
    },
  };
}
export function createResendProvider(
  apiKey: string,
  config: EmailConfiguration,
  fetcher: typeof fetch = fetch,
): EmailProvider {
  return {
    async send(message, key) {
      let content: ReturnType<typeof frozenEmailContent>;
      try {
        content = frozenEmailContent(message);
      } catch {
        return { state: "failed", error: "email_presentation_invalid" };
      }
      try {
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.email],
            subject: message.subject,
            text: content.text,
            ...(content.html && content.logo
              ? {
                  html: content.html,
                  attachments: [
                    {
                      filename: content.logo.filename,
                      content: content.logo.contentBase64,
                      content_type: content.logo.contentType,
                      content_id: content.logo.cid,
                    },
                  ],
                }
              : {}),
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (response.status >= 500)
          return { state: "unknown", error: `provider_${response.status}` };
        if (!response.ok) return { state: "failed", error: `provider_${response.status}` };
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "id" in body && typeof body.id === "string")
          return { state: "sent", providerId: body.id };
        return { state: "unknown", error: "provider_response_unverified" };
      } catch {
        return { state: "unknown", error: "provider_result_unverified" };
      }
    },
  };
}
export function getEmailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider | null {
  const status = emailConfigStatus(env);
  if (!status.configured) return null;
  if (status.provider === "gmail")
    return createGmailProvider({
      provider: "gmail",
      user: env.RECALINO_GMAIL_USER ?? "",
      appPassword: env.RECALINO_GMAIL_APP_PASSWORD ?? "",
      from: status.sender ?? "",
      appLink: status.appLink ?? "",
      ...(status.replyTo ? { replyTo: status.replyTo } : {}),
    });
  return createResendProvider(env.RESEND_API_KEY ?? "", {
    provider: "resend",
    from: status.sender ?? "",
    appLink: status.appLink ?? "",
    ...(status.replyTo ? { replyTo: status.replyTo } : {}),
  });
}
export const getEmailDeliveryConfig = emailConfigStatus;
/** Only previously approved immutable snapshots are dispatched; missing configuration leaves them queued. */
export async function runEmailOutbox(
  db: SupportDb,
  options: {
    provider?: EmailProvider;
    env?: Record<string, string | undefined>;
    limit?: number;
    now?: Date;
    /** Trusted Auth directory, checked again immediately before dispatch. */
    resolveRecipientEmail?: (userId: string) => Promise<string | null>;
  } = {},
): Promise<{
  configured: boolean;
  processed: number;
  sent: number;
  failed: number;
  unknown: number;
  cancelled: number;
}> {
  const env = options.env ?? process.env;
  const provider = options.provider ?? getEmailProvider(env);
  const result = {
    configured: !!provider,
    processed: 0,
    sent: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
  };
  if (!provider) return result;
  const now = options.now ?? new Date();
  await sql`update support.email_outbox set state='unknown',last_error='interrupted_send_needs_reconciliation' where state='sending' and attempted_at<${new Date(now.getTime() - 5 * 60000)}`.execute(
    db,
  );
  const limit = Math.min(25, Math.max(1, options.limit ?? 10));
  for (let i = 0; i < limit; i++) {
    const claimed = await transaction(db, async (tx) => {
      const row = (
        await sql<OutboxRow>`select * from support.email_outbox where state='queued' order by created_at for update skip locked limit 1`.execute(
          tx,
        )
      ).rows[0];
      if (!row) return null;
      if (row.user_id && !(await accountExists(tx, row.user_id))) {
        await sql`update support.email_outbox set state='cancelled',last_error='account_deleted' where id=${row.id}::uuid`.execute(
          tx,
        );
        return { cancelled: true, row };
      }
      const current = (
        await sql<OutboxRow>`update support.email_outbox set state='sending',attempted_at=${new Date()},attempts=attempts+1 where id=${row.id}::uuid returning *`.execute(
          tx,
        )
      ).rows[0];
      return current ? { cancelled: false, row: current } : null;
    });
    if (!claimed) break;
    result.processed++;
    if (claimed.cancelled) {
      result.cancelled++;
      continue;
    }
    const row = claimed.row;
    if (row.user_id && options.resolveRecipientEmail) {
      let currentEmail: string | null;
      try {
        currentEmail = await options.resolveRecipientEmail(row.user_id);
      } catch {
        await sql`update support.email_outbox set state='failed',last_error='contact_verification_unavailable' where id=${row.id}::uuid and state='sending'`.execute(
          db,
        );
        result.failed++;
        continue;
      }
      if (
        !currentEmail ||
        currentEmail.trim().toLowerCase() !== row.email.toLowerCase() ||
        !(await accountExists(db, row.user_id))
      ) {
        await sql`update support.email_outbox set state='cancelled',last_error=${currentEmail ? "recipient_address_changed" : "recipient_unavailable"} where id=${row.id}::uuid and state='sending'`.execute(
          db,
        );
        result.cancelled++;
        continue;
      }
    }
    if (row.thread_id) {
      const preference = (
        await sql<{
          email_notification: boolean;
        }>`select email_notification from support.thread where id=${row.thread_id}::uuid`.execute(
          db,
        )
      ).rows[0];
      if (!preference?.email_notification) {
        await sql`update support.email_outbox set state='cancelled',last_error='notification_preference_changed' where id=${row.id}::uuid and state='sending'`.execute(
          db,
        );
        result.cancelled++;
        continue;
      }
    }
    let attempt: Awaited<ReturnType<EmailProvider["send"]>>;
    let message: OutboundEmail;
    try {
      message = outbound(row);
      // Deterministic snapshot validation fails before dispatch. It is not an ambiguous delivery.
      frozenEmailContent(message);
    } catch {
      await sql`update support.email_outbox set state='failed',last_error='email_presentation_invalid' where id=${row.id}::uuid and state='sending'`.execute(
        db,
      );
      result.failed++;
      continue;
    }
    try {
      attempt = await provider.send(message, `recalino-email/${row.id}`);
    } catch {
      attempt = { state: "unknown", error: "provider_result_unverified" };
    }
    await sql`update support.email_outbox set state=${attempt.state},provider_id=${attempt.state === "sent" ? attempt.providerId : null},sent_at=${attempt.state === "sent" ? new Date() : null},last_error=${attempt.state === "sent" ? null : attempt.error} where id=${row.id}::uuid and state='sending'`.execute(
      db,
    );
    result[attempt.state]++;
  }
  return result;
}
