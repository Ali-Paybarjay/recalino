import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import type { SendMailOptions } from "nodemailer/lib/mailer";
import { describe, expect, it, vi } from "vitest";
import type { OutboundEmail } from "./contracts";
import { getEmailLogo } from "./email-logo";
import { renderEmailPresentation } from "./presentation";
import {
  createGmailProvider,
  emailConfigStatus,
  type GmailEmailConfiguration,
  type GmailTransportFactory,
  getEmailProvider,
} from "./provider";

const env = {
  RECALINO_EMAIL_PROVIDER: "gmail",
  RECALINO_GMAIL_USER: "sender.synthetic@gmail.com",
  RECALINO_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  RECALINO_EMAIL_FROM: "Recalino <sender.synthetic@gmail.com>",
  RECALINO_EMAIL_REPLY_TO: "Replies <sender.synthetic@gmail.com>",
  RECALINO_PUBLIC_APP_URL: "https://example.invalid",
};
const config: GmailEmailConfiguration = {
  provider: "gmail",
  user: env.RECALINO_GMAIL_USER,
  appPassword: env.RECALINO_GMAIL_APP_PASSWORD,
  from: env.RECALINO_EMAIL_FROM,
  replyTo: env.RECALINO_EMAIL_REPLY_TO,
  appLink: env.RECALINO_PUBLIC_APP_URL,
};
const message: OutboundEmail = {
  id: "3f0d44c7-862f-4552-b138-66d5d6381db8",
  draftId: null,
  userId: null,
  email: "recipient@example.invalid",
  subject: "خوش آمدید — Recalino",
  body: "سلام،\nWelcome to Recalino.\n<script>literal text</script>\n.",
  language: "fa",
  state: "queued",
  attempts: 0,
  providerId: null,
  lastError: null,
  sentAt: null,
  createdAt: "2026-10-05T12:00:00Z",
  threadId: null,
};
const key = `recalino-email/${message.id}`;
const messageId = `<recalino.${createHash("sha256").update(key).digest("hex")}@gmail.com>`;
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    accepted: [message.email],
    rejected: [],
    response: "250 2.0.0 synthetic accepted",
    messageId,
    ...overrides,
  };
}
function fakeFactory(result: () => Promise<unknown> = async () => receipt()) {
  const sendMail = vi.fn((_input: SendMailOptions) => result());
  const close = vi.fn();
  const factory: GmailTransportFactory = vi.fn(() => ({ sendMail, close }));
  return { factory, sendMail, close };
}
function brandedMessage(language: "en" | "fa" = "fa"): OutboundEmail {
  return {
    ...message,
    language,
    presentation: renderEmailPresentation({
      templateId: "pilot_welcome",
      language,
      subject: message.subject,
      body: message.body,
      presentation: {
        headline: "Welcome <sample> & Recalino",
        preheader: "A reviewed preview",
        action: { label: "Open <Recalino>", url: "https://example.invalid/path?a=1&b=2" },
      },
    }),
  };
}
function mimeContent(mime: string, type: string): Buffer {
  const part = new RegExp(
    `Content-Type: ${type}(?:;[^\\r\\n]*)?\\r\\n([\\s\\S]*?)\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--|$)`,
  ).exec(mime);
  if (!part || !/Content-Transfer-Encoding: base64/i.test(part[1] ?? ""))
    throw new Error(`Missing encoded MIME part: ${type}`);
  return Buffer.from(part[2] ?? "", "base64");
}

describe("AC-ADM-011 Gmail configuration", () => {
  it("selects Gmail without requiring or exposing a Resend key or Gmail password", () => {
    const status = emailConfigStatus(env);
    expect(status).toEqual({
      configured: true,
      provider: "gmail",
      sender: env.RECALINO_EMAIL_FROM,
      replyTo: env.RECALINO_EMAIL_REPLY_TO,
      appLink: env.RECALINO_PUBLIC_APP_URL,
      missing: [],
    });
    expect(JSON.stringify(status)).not.toContain("abcd");
    expect(getEmailProvider(env)).not.toBeNull();
  });
  it("preserves the default Resend selection and disables an unknown explicit provider", () => {
    expect(emailConfigStatus({}).provider).toBe("resend");
    const unknown = { ...env, RECALINO_EMAIL_PROVIDER: "invalid" };
    expect(emailConfigStatus(unknown)).toMatchObject({ configured: false, provider: null });
    expect(emailConfigStatus(unknown).missing).toContain("RECALINO_EMAIL_PROVIDER");
    expect(getEmailProvider(unknown)).toBeNull();
    expect(
      getEmailProvider({
        RESEND_API_KEY: "synthetic-only",
        RECALINO_EMAIL_FROM: "sender@example.invalid",
        RECALINO_PUBLIC_APP_URL: "https://example.invalid",
      }),
    ).not.toBeNull();
  });
  it.each([
    ["RECALINO_GMAIL_USER", "not-an-email"],
    ["RECALINO_GMAIL_USER", "sender@example.invalid"],
    ["RECALINO_GMAIL_APP_PASSWORD", ""],
    ["RECALINO_GMAIL_APP_PASSWORD", "regular-password"],
    ["RECALINO_GMAIL_APP_PASSWORD", "abcd\nefghijklmnop"],
    ["RECALINO_EMAIL_FROM", "Other <other@gmail.com>"],
    ["RECALINO_EMAIL_FROM", "sender.synthetic@gmail.com\r\nBcc: hidden@example.invalid"],
    ["RECALINO_EMAIL_FROM", "Sender <sender.synthetic@gmail.com>, other@gmail.com"],
    ["RECALINO_EMAIL_REPLY_TO", "invalid"],
    ["RECALINO_PUBLIC_APP_URL", "https://"],
    ["RECALINO_PUBLIC_APP_URL", "https://user:password@example.invalid"],
  ])("keeps invalid %s unconfigured without attempting a transport", (setting, value) => {
    const input = { ...env, [setting]: value };
    const status = emailConfigStatus(input);
    expect(status.configured).toBe(false);
    expect(status.missing).toContain(setting);
    expect(getEmailProvider(input)).toBeNull();
  });
  it("normalizes Gmail address case and validates direct constructor configuration", () => {
    expect(
      emailConfigStatus({ ...env, RECALINO_GMAIL_USER: "Sender.Synthetic@GMAIL.com" }).configured,
    ).toBe(true);
    const mock = fakeFactory();
    expect(() => createGmailProvider({ ...config, from: "other@gmail.com" }, mock.factory)).toThrow(
      "invalid_gmail_configuration",
    );
    expect(mock.factory).not.toHaveBeenCalled();
  });
});

describe("AC-ADM-011 Gmail SMTP outcomes", () => {
  it("uses verified TLS, normalized app password, bounded timeouts and exactly one private recipient", async () => {
    const mock = fakeFactory();
    const adapter = createGmailProvider(config, mock.factory);
    expect(await adapter.send(message, key)).toEqual({ state: "sent", providerId: messageId });
    expect(mock.factory).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      forceAuth: true,
      auth: { user: config.user, pass: "abcdefghijklmnop" },
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
    expect(mock.sendMail).toHaveBeenCalledWith({
      from: { name: "Recalino", address: config.user },
      to: { address: message.email },
      envelope: { from: config.user, to: [message.email] },
      replyTo: { name: "Replies", address: config.user },
      subject: message.subject,
      text: message.body,
      textEncoding: "base64",
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(mock.close).toHaveBeenCalledOnce();
    await adapter.send(message, key);
    expect(mock.sendMail).toHaveBeenCalledTimes(2);
    // Message-ID assists reconciliation, but does not pretend that Gmail deduplicates sends.
    expect(mock.sendMail.mock.calls[1]?.[0].messageId).toBe(messageId);
  });
  it.each([
    { accepted: [] },
    { accepted: [message.email, "another@example.invalid"] },
    { accepted: ["another@example.invalid"] },
    { rejected: [message.email] },
    { pending: [message.email] },
    { response: "354 continue" },
    { response: "550 rejected" },
    { messageId: "different-reference" },
  ])("does not call an unverified acceptance delivered: %j", async (overrides) => {
    const mock = fakeFactory(async () => receipt(overrides));
    expect(await createGmailProvider(config, mock.factory).send(message, key)).toEqual({
      state: "unknown",
      error: "smtp_response_unverified",
    });
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it.each([
    [{ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }, "smtp_authentication_rejected"],
    [{ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 }, "smtp_envelope_rejected"],
    [{ code: "EENVELOPE", command: "RCPT TO", responseCode: 450 }, "smtp_envelope_rejected"],
  ])(
    "classifies proven pre-content SMTP rejection as failed and strips raw details",
    async (details, error) => {
      const mock = fakeFactory(async () => {
        throw Object.assign(new Error("private message abcdefghijklmnop"), details, {
          response: "private echoed credentials abcdefghijklmnop",
        });
      });
      expect(await createGmailProvider(config, mock.factory).send(message, key)).toEqual({
        state: "failed",
        error,
      });
    },
  );
  it.each([
    { code: "ETIMEDOUT", command: "DATA" },
    { code: "ESOCKET", responseCode: 421 },
    { code: "EAUTH" },
    { code: "EENVELOPE", command: "DATA", responseCode: 550 },
    { code: "EMESSAGE", command: "DATA", responseCode: 550 },
    { code: "EENVELOPE", command: "RCPT TO" },
  ])(
    "preserves ambiguous send failures as unknown without automatic retries: %j",
    async (details) => {
      const mock = fakeFactory(async () => {
        throw Object.assign(new Error("private error"), details);
      });
      expect(await createGmailProvider(config, mock.factory).send(message, key)).toEqual({
        state: "unknown",
        error: "smtp_result_unverified",
      });
      expect(mock.sendMail).toHaveBeenCalledOnce();
    },
  );
  it("bounds the whole send at 15 seconds and closes without retrying a stalled request", async () => {
    vi.useFakeTimers();
    try {
      const mock = fakeFactory(() => new Promise(() => {}));
      const result = createGmailProvider(config, mock.factory).send(message, key);
      await vi.advanceTimersByTimeAsync(15000);
      expect(await result).toEqual({ state: "unknown", error: "smtp_result_unverified" });
      expect(mock.sendMail).toHaveBeenCalledOnce();
      expect(mock.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    { email: "recipient@example.invalid, hidden@example.invalid" },
    { subject: "Subject\r\nBcc: hidden@example.invalid" },
    { subject: "x".repeat(301) },
    { body: "x".repeat(24001) },
    { body: "nul\0content" },
  ])(
    "rejects invalid frozen messages before creating any network transport: %j",
    async (overrides) => {
      const mock = fakeFactory();
      expect(
        await createGmailProvider(config, mock.factory).send({ ...message, ...overrides }, key),
      ).toEqual({ state: "failed", error: "smtp_message_invalid" });
      expect(mock.factory).not.toHaveBeenCalled();
    },
  );
  it.each([
    { html: '<script>fetch("https://example.invalid")</script>', text: "Unapproved" },
    { html: '<img src="file:///private">', text: "Unapproved" },
    "",
  ])("rejects an invalid presentation before creating any SMTP transport: %j", async (input) => {
    const mock = fakeFactory();
    const invalid = { ...message, presentation: input } as unknown as OutboundEmail;
    expect(await createGmailProvider(config, mock.factory).send(invalid, key)).toEqual({
      state: "failed",
      error: "email_presentation_invalid",
    });
    expect(mock.factory).not.toHaveBeenCalled();
  });
  it("keeps explicit legacy null presentation as plain text without attachments", async () => {
    const mock = fakeFactory();
    expect(
      (
        await createGmailProvider(config, mock.factory).send(
          { ...message, presentation: null },
          key,
        )
      ).state,
    ).toBe("sent");
    const input = mock.sendMail.mock.calls[0]?.[0];
    expect(input?.text).toBe(message.body);
    expect(input).not.toHaveProperty("html");
    expect(input).not.toHaveProperty("attachments");
  });
  it("encodes Persian and English content as bounded plain text with the real MIME compiler and no network", async () => {
    const compiler = createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let mime = "";
    const factory: GmailTransportFactory = () => ({
      async sendMail(input: SendMailOptions) {
        const generated = await compiler.sendMail(input);
        mime = generated.message.toString();
        return receipt({ messageId: generated.messageId });
      },
      close: () => compiler.close(),
    });
    expect((await createGmailProvider(config, factory).send(message, key)).state).toBe("sent");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    const headers = mime.split("\r\n\r\n")[0]?.replace(/\r\n[ \t]+/g, " ") ?? "";
    expect(headers).toContain(`Message-ID: ${messageId}`);
    const subject = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(headers)?.[1];
    expect(Buffer.from(subject ?? "", "base64").toString("utf8")).toBe(message.subject);
    expect(mime).toContain("To: recipient@example.invalid");
    expect(mime).not.toContain("Bcc:");
    expect(mime).not.toContain("Content-Type: text/html");
    const encodedBody = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(
      Buffer.from(encodedBody, "base64").toString("utf8").replace(/\r\n/g, "\n").trimEnd(),
    ).toBe(message.body);
  });
  it.each(["en", "fa"] as const)(
    "compiles the exact approved %s HTML and fallback text with an inline trusted PNG without network",
    async (language) => {
      const branded = brandedMessage(language);
      const snapshot = branded.presentation;
      if (!snapshot) throw new Error("Missing presentation");
      const logo = getEmailLogo(snapshot.logoVersion);
      const compiler = createTransport({
        streamTransport: true,
        buffer: true,
        newline: "windows",
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      let mime = "";
      let input: SendMailOptions | undefined;
      const factory: GmailTransportFactory = () => ({
        async sendMail(value: SendMailOptions) {
          input = value;
          const generated = await compiler.sendMail(value);
          mime = generated.message.toString();
          return receipt({ messageId: generated.messageId });
        },
        close: () => compiler.close(),
      });
      expect((await createGmailProvider(config, factory).send(branded, key)).state).toBe("sent");
      expect(input?.html).toBe(snapshot.html);
      expect(input?.text).toBe(snapshot.text);
      expect(input?.attachments).toEqual([
        {
          filename: logo.filename,
          content: Buffer.from(logo.contentBase64, "base64"),
          contentType: "image/png",
          contentDisposition: "inline",
          cid: logo.cid,
        },
      ]);
      expect(mime).toContain("Content-Type: multipart/alternative;");
      expect(mime).toContain("Content-Type: multipart/related;");
      expect(mime).toContain(`Content-ID: <${logo.cid}>`);
      expect(mime).toContain("Content-Disposition: inline;");
      expect(mime).not.toContain("Bcc:");
      const html = mimeContent(mime, "text/html").toString("utf8");
      const text = mimeContent(mime, "text/plain").toString("utf8");
      expect(html.replace(/\r\n/g, "\n").trimEnd()).toBe(snapshot.html.trimEnd());
      expect(text.replace(/\r\n/g, "\n").trimEnd()).toBe(snapshot.text.trimEnd());
      expect(mimeContent(mime, "image/png")).toEqual(Buffer.from(logo.contentBase64, "base64"));
      expect(html).toContain(`dir="${language === "fa" ? "rtl" : "ltr"}"`);
      expect(html).toContain(`src="cid:${logo.cid}"`);
      expect(html).toContain("&lt;script&gt;literal text&lt;/script&gt;");
      expect(html).toContain("Welcome &lt;sample&gt; &amp; Recalino");
      expect(html).not.toContain("<script>");
      expect(text).toContain(message.body);
    },
  );
  it("rejects tampered, unsupported and language-mismatched snapshots before SMTP", async () => {
    const branded = brandedMessage();
    const snapshot = branded.presentation;
    if (!snapshot) throw new Error("Missing presentation");
    const variants: OutboundEmail[] = [
      {
        ...branded,
        presentation: { ...snapshot, html: `${snapshot.html}<script>invalid</script>` },
      },
      { ...branded, presentation: { ...snapshot, logoVersion: "untrusted-logo" } },
      { ...branded, presentation: { ...snapshot, designVersion: "unsupported-design" } },
      { ...branded, language: "en" },
      { ...branded, body: "Changed source text" },
    ];
    for (const invalid of variants) {
      const mock = fakeFactory();
      expect(await createGmailProvider(config, mock.factory).send(invalid, key)).toEqual({
        state: "failed",
        error: "email_presentation_invalid",
      });
      expect(mock.factory).not.toHaveBeenCalled();
    }
  });
});
