import { sql } from "kysely";
import { accountExists } from "../acc";
import { type SupportDb, transaction } from "./common";
import type { OutboundEmail } from "./contracts";
import { type OutboxRow, outbound } from "./email";

export interface EmailProvider {
  send(
    message: OutboundEmail,
    idempotencyKey: string,
  ): Promise<
    { state: "sent"; providerId: string } | { state: "failed" | "unknown"; error: string }
  >;
}
export interface EmailConfiguration {
  provider: "resend";
  from: string;
  replyTo?: string;
  appLink: string;
}
export function emailConfigStatus(env: Record<string, string | undefined> = process.env): {
  configured: boolean;
  provider: "resend";
  sender: string | null;
  replyTo: string | null;
  appLink: string | null;
  missing: string[];
} {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (
    !env.RECALINO_EMAIL_FROM ||
    !/@/.test(env.RECALINO_EMAIL_FROM) ||
    /[\r\n]/.test(env.RECALINO_EMAIL_FROM)
  )
    missing.push("RECALINO_EMAIL_FROM");
  if (!env.RECALINO_PUBLIC_APP_URL || !/^https?:\/\//.test(env.RECALINO_PUBLIC_APP_URL))
    missing.push("RECALINO_PUBLIC_APP_URL");
  return {
    configured: missing.length === 0,
    provider: "resend",
    sender: missing.includes("RECALINO_EMAIL_FROM") ? null : (env.RECALINO_EMAIL_FROM ?? null),
    replyTo: env.RECALINO_EMAIL_REPLY_TO ?? null,
    appLink: missing.includes("RECALINO_PUBLIC_APP_URL")
      ? null
      : (env.RECALINO_PUBLIC_APP_URL ?? null),
    missing,
  };
}
export function createResendProvider(
  apiKey: string,
  config: EmailConfiguration,
  fetcher: typeof fetch = fetch,
): EmailProvider {
  return {
    async send(message, key) {
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
            text: message.body,
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
  const status = emailConfigStatus(env);
  const provider =
    options.provider ??
    (status.configured
      ? createResendProvider(env.RESEND_API_KEY ?? "", {
          provider: "resend",
          from: status.sender ?? "",
          appLink: status.appLink ?? "",
          ...(status.replyTo ? { replyTo: status.replyTo } : {}),
        })
      : null);
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
    try {
      attempt = await provider.send(outbound(row), `recalino-email/${row.id}`);
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
