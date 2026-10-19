import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { EmailDraftInput, OutboundEmail } from "./contracts";
import { reconcileEmail, renderEmailRecipients } from "./email";
import { getEmailLogo } from "./email-logo";
import { routineReply } from "./feedback";
import { renderEmailPresentation } from "./presentation";
import { createResendProvider, emailConfigStatus } from "./provider";
import { DEFAULT_EMAIL_TEMPLATES } from "./templates";

function welcomeInput(): EmailDraftInput {
  return {
    operationKey: randomUUID(),
    recipients: [
      {
        userId: randomUUID(),
        email: "learner@example.invalid",
        firstName: "Sample learner",
        language: "en",
      },
    ],
    templateId: "pilot_welcome",
    language: "en",
    variables: { app_link: "https://example.invalid" },
    reason: "Synthetic test",
  };
}
const welcome = DEFAULT_EMAIL_TEMPLATES.find((t) => t.id === "pilot_welcome");
if (!welcome) throw new Error("template missing");
describe("AC-ADM-008/009 rendered approval snapshots", () => {
  it("has all nine bilingual templates with consistent IDs", () => {
    expect(DEFAULT_EMAIL_TEMPLATES).toHaveLength(9);
    expect(new Set(DEFAULT_EMAIL_TEMPLATES.map((t) => t.id)).size).toBe(9);
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      expect(t.content.en.subject).not.toBe("");
      expect(t.content.fa.subject).not.toBe("");
    }
  });
  it("uses recipient language independently of admin language and trusted identity", () => {
    const input = welcomeInput();
    input.language = "recipient";
    input.recipients.push({
      userId: randomUUID(),
      email: "fa@example.invalid",
      firstName: "نمونه",
      language: "fa",
    });
    input.variables = {
      app_link: "https://example.invalid",
      first_name: "Injected",
      account_email: "wrong@example.invalid",
    };
    const results = renderEmailRecipients(input, welcome);
    expect(results[0]?.language).toBe("en");
    expect(results[1]?.language).toBe("fa");
    expect(results[0]?.subject).toContain("Sample learner");
    expect(results[0]?.body).toContain("learner@example.invalid");
    expect(results[1]?.subject).toContain("نمونه");
  });
  it("keeps both localized versions authoritative when the last edited scalar text is Persian", () => {
    const input = welcomeInput();
    input.language = "recipient";
    input.recipients.push({ userId: randomUUID(), email: "fa@example.invalid", language: "fa" });
    input.subject = "موضوع فارسی";
    input.body = "متن فارسی";
    input.localizedContent = {
      en: { subject: "Reviewed English subject", body: "Reviewed English body" },
      fa: { subject: "موضوع فارسی تأییدشده", body: "متن فارسی تأییدشده" },
    };
    const results = renderEmailRecipients(input, welcome);
    expect(results[0]).toMatchObject({
      language: "en",
      subject: "Reviewed English subject",
      body: "Reviewed English body",
    });
    expect(results[1]).toMatchObject({
      language: "fa",
      subject: "موضوع فارسی تأییدشده",
      body: "متن فارسی تأییدشده",
    });
  });
  it("renders routine templates immediately with localized prose while retaining truthful required data", () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES)
      for (const language of ["en", "fa"] as const) {
        const input = welcomeInput();
        input.templateId = template.id;
        input.language = language;
        input.variables = {
          app_link: "https://example.invalid",
          conversation_link: "https://example.invalid/help",
          conversation_subject: "Synthetic reviewed question",
          reply_text: "Synthetic reviewed response",
          quota_summary: "Synthetic allocation: 10 minutes",
          period_text: "2040-01-01 — 2040-01-31 (UTC)",
          pilot_end_date: "2040-01-31",
          issue_summary: "Synthetic maintenance notice",
          current_status_text: "Synthetic reviewed status",
        };
        const recipient = renderEmailRecipients(input, template)[0];
        expect(recipient?.missingVariables).toEqual([]);
        expect(recipient?.body).not.toContain("{{");
        for (const value of Object.values(template.variableDefaults?.[language] ?? {}))
          expect(recipient?.body).toContain(value);
      }
  });
  it("keeps optional routine defaults editable and leaves custom and factual placeholders required", () => {
    const invitation = DEFAULT_EMAIL_TEMPLATES.find((item) => item.id === "pilot_invitation");
    const notice = DEFAULT_EMAIL_TEMPLATES.find((item) => item.id === "service_notice");
    if (!invitation || !notice) throw new Error("Routine template missing");
    const input = welcomeInput();
    input.templateId = invitation.id;
    input.language = "fa";
    input.variables = {
      app_link: "https://example.invalid",
      next_step_text: "گام بعدی بازبینی‌شده",
    };
    expect(renderEmailRecipients(input, invitation)[0]?.body).toContain("گام بعدی بازبینی‌شده");
    input.variables.next_step_text = " ";
    expect(renderEmailRecipients(input, invitation)[0]?.body).toContain(
      invitation.variableDefaults?.fa?.next_step_text,
    );
    input.body = "{{custom_note2}}";
    input.variables.custom_note2 = " ";
    expect(renderEmailRecipients(input, invitation)[0]?.missingVariables).toEqual(["custom_note2"]);
    delete input.body;
    input.templateId = notice.id;
    expect(renderEmailRecipients(input, notice)[0]?.missingVariables).toEqual([
      "current_status_text",
      "issue_summary",
    ]);
  });
  it("validates only actual recipient languages and falls back to the verified unedited translation", () => {
    const input = welcomeInput();
    input.language = "recipient";
    const first = input.recipients[0];
    if (!first) throw new Error("Recipient missing");
    first.language = "fa";
    input.subject = "";
    input.body = "";
    input.localizedContent = {
      fa: { subject: "موضوع بازبینی‌شده", body: "متن بازبینی‌شده" },
      en: { subject: "", body: "" },
    };
    expect(renderEmailRecipients(input, welcome)[0]).toMatchObject({
      language: "fa",
      subject: "موضوع بازبینی‌شده",
      body: "متن بازبینی‌شده",
    });
    delete input.localizedContent.en;
    input.recipients.push({ userId: randomUUID(), email: "en@example.invalid", language: "en" });
    expect(renderEmailRecipients(input, welcome)[1]?.subject).toBe("Welcome to Recalino, there");
    expect(() =>
      renderEmailRecipients(input, {
        ...welcome,
        id: null,
        content: { en: { subject: "", body: "" }, fa: { subject: "", body: "" } },
      }),
    ).toThrow();
  });
  it("ignores incomplete unused locale presentation while enforcing its bounds and actual recipient fields", () => {
    const input = welcomeInput();
    input.language = "recipient";
    input.localizedContent = {
      en: { subject: "Reviewed English subject", body: "Reviewed English body" },
      fa: { subject: "", body: "" },
    };
    input.localizedPresentation = {
      en: { action: null },
      fa: { action: { label: "", url: "" } },
    };
    expect(renderEmailRecipients(input, welcome)[0]?.subject).toBe("Reviewed English subject");
    const recipient = input.recipients[0];
    if (!recipient) throw new Error("Synthetic recipient missing");
    recipient.language = "fa";
    expect(() => renderEmailRecipients(input, welcome)).toThrowError(
      expect.objectContaining({
        details: { fields: { "localizedContent.fa.subject": ["required"] } },
      }),
    );
    input.localizedContent.fa = { subject: "موضوع آماده", body: "متن آماده" };
    expect(() => renderEmailRecipients(input, welcome)).toThrowError(
      expect.objectContaining({
        details: {
          fields: {
            "localizedPresentation.fa.action.label": ["too_small"],
            "localizedPresentation.fa.action.url": ["too_small"],
          },
        },
      }),
    );
    input.localizedPresentation.fa = { action: { label: "ورود", url: "javascript:alert(1)" } };
    expect(() => renderEmailRecipients(input, welcome)).toThrowError(
      expect.objectContaining({
        details: {
          fields: { "localizedPresentation.fa.action.url": ["https_action_url_required"] },
        },
      }),
    );
    recipient.language = "en";
    expect(renderEmailRecipients(input, welcome)[0]?.missingVariables).toEqual([]);
    input.localizedPresentation.fa = { action: { label: "ورود", url: "x".repeat(2049) } };
    expect(() => renderEmailRecipients(input, welcome)).toThrow();
  });
  it("shows unresolved variables and rejects duplicate recipients or multiline subject", () => {
    const input = welcomeInput();
    input.variables = {};
    expect(renderEmailRecipients(input, welcome)[0]?.missingVariables).toEqual(["app_link"]);
    const recipient = input.recipients[0];
    if (!recipient) throw new Error("Missing synthetic recipient");
    input.recipients.push({ ...recipient });
    expect(() => renderEmailRecipients(input, welcome)).toThrow();
    input.recipients.pop();
    input.subject = "Header\nInjection";
    expect(() => renderEmailRecipients(input, welcome)).toThrow();
  });
  it("keeps untrusted text as plain text and never evaluates markup", () => {
    const input = welcomeInput();
    input.body = "{{first_name}} <script>steal()</script> {{app_link}}";
    const output = renderEmailRecipients(input, welcome)[0];
    expect(output?.body).toContain("<script>steal()</script>");
    expect(output?.missingVariables).toEqual([]);
  });
  it("renders digit-suffixed manual variable keys and rejects malformed record fields", () => {
    const input = welcomeInput();
    input.body = "Reviewed note: {{custom_note2}}";
    input.presentation = { action: null };
    input.variables = { custom_note2: "Routine owner text" };
    expect(renderEmailRecipients(input, welcome)[0]).toMatchObject({
      body: "Reviewed note: Routine owner text",
      missingVariables: [],
    });
    const userId = input.recipients[0]?.userId;
    if (!userId) throw new Error("Missing synthetic recipient");
    input.recipientVariables = { [userId]: { custom_note2: "Personalized routine text" } };
    expect(renderEmailRecipients(input, welcome)[0]?.body).toBe(
      "Reviewed note: Personalized routine text",
    );
    input.variables = { "2custom_note": "Invalid leading digit" };
    expect(() => renderEmailRecipients(input, welcome)).toThrow();
    input.variables = {};
    input.recipientVariables = { [userId]: { "custom-note2": "Invalid punctuation" } };
    expect(() => renderEmailRecipients(input, welcome)).toThrow();
  });
  it("provides truthful routine fallback instead of claiming an AI call or a fixed issue", () => {
    expect(routineReply("problem", "en")).toContain("reviewing");
    expect(routineReply("problem", "en")).not.toContain("fixed");
    expect(routineReply("question", "fa")).toContain("پرسش");
  });
});
describe("AC-ADM-011 email provider outcomes", () => {
  const message: OutboundEmail = {
    id: randomUUID(),
    draftId: null,
    userId: null,
    email: "recipient@example.invalid",
    subject: "Synthetic",
    body: "Plain text",
    language: "en",
    state: "queued",
    attempts: 0,
    providerId: null,
    lastError: null,
    sentAt: null,
    createdAt: new Date().toISOString(),
    threadId: null,
  };
  it("reports unconfigured state without exposing credentials", () => {
    const result = emailConfigStatus({ RESEND_API_KEY: "secret-test" });
    expect(result.configured).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-test");
  });
  it("uses one private recipient and durable provider idempotency", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "provider-test" }));
    const adapter = createResendProvider(
      "test",
      {
        provider: "resend",
        from: "Sender <sender@example.invalid>",
        appLink: "https://example.invalid",
      },
      fetcher as typeof fetch,
    );
    expect(await adapter.send(message, "same-key")).toEqual({
      state: "sent",
      providerId: "provider-test",
    });
    const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((args[1].headers as Record<string, string>)["idempotency-key"]).toBe("same-key");
    expect(JSON.parse(args[1].body as string).to).toEqual([message.email]);
    expect(JSON.parse(args[1].body as string)).not.toHaveProperty("html");
    expect(JSON.parse(args[1].body as string)).not.toHaveProperty("attachments");
  });
  it("rejects a malformed branded snapshot without contacting Resend", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "provider-test" }));
    const adapter = createResendProvider(
      "test",
      {
        provider: "resend",
        from: "Sender <sender@example.invalid>",
        appLink: "https://example.invalid",
      },
      fetcher as typeof fetch,
    );
    const malformed = {
      ...message,
      presentation: { html: '<img src="https://private.invalid">', text: "Unapproved" },
    } as unknown as OutboundEmail;
    expect(await adapter.send(malformed, "same-key")).toEqual({
      state: "failed",
      error: "email_presentation_invalid",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends the frozen HTML and fallback text with the exact versioned in-memory logo to Resend", async () => {
    const presentation = renderEmailPresentation({
      language: message.language,
      subject: message.subject,
      body: message.body,
      templateId: "pilot_welcome",
      presentation: {
        headline: "Reviewed welcome",
        preheader: "Approved preview",
        action: { label: "Open Recalino", url: "https://approved.example.invalid" },
      },
    });
    const fetcher = vi.fn(async () => Response.json({ id: "provider-test" }));
    const adapter = createResendProvider(
      "test",
      {
        provider: "resend",
        from: "Sender <sender@example.invalid>",
        replyTo: "Replies <reply@example.invalid>",
        appLink: "https://changed.example.invalid",
      },
      fetcher as typeof fetch,
    );
    expect(await adapter.send({ ...message, presentation }, "same-key")).toEqual({
      state: "sent",
      providerId: "provider-test",
    });
    const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const logo = getEmailLogo(presentation.logoVersion);
    expect(JSON.parse(args[1].body as string)).toEqual({
      from: "Sender <sender@example.invalid>",
      to: [message.email],
      subject: message.subject,
      text: presentation.text,
      html: presentation.html,
      reply_to: "Replies <reply@example.invalid>",
      attachments: [
        {
          filename: logo.filename,
          content: logo.contentBase64,
          content_type: logo.contentType,
          content_id: logo.cid,
        },
      ],
    });
    expect((args[1].headers as Record<string, string>)["idempotency-key"]).toBe("same-key");
  });
  it("does not call a timeout or ambiguous server response failed/delivered", async () => {
    const config = {
      provider: "resend" as const,
      from: "sender@example.invalid",
      appLink: "https://example.invalid",
    };
    expect(
      (
        await createResendProvider(
          "test",
          config,
          vi.fn(async () => new Response("", { status: 503 })) as typeof fetch,
        ).send(message, "key")
      ).state,
    ).toBe("unknown");
    expect(
      (
        await createResendProvider(
          "test",
          config,
          vi.fn(async () => {
            throw new Error("Timeout");
          }) as typeof fetch,
        ).send(message, "key")
      ).state,
    ).toBe("unknown");
    expect(
      (
        await createResendProvider(
          "test",
          config,
          vi.fn(async () => new Response("", { status: 422 })) as typeof fetch,
        ).send(message, "key")
      ).state,
    ).toBe("failed");
  });
});

describe("reconcileEmail trusted-operator API (FR-SUPPORT-004, QUA-06)", () => {
  // Every rejection below happens before the outbox is read or changed.
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error("database must not be touched");
      },
    },
  ) as Parameters<typeof reconcileEmail>[0];
  const valid = { id: randomUUID(), state: "failed" as const, reason: "Provider log shows reject" };
  it("requires an operator, a verified provider reference for sent, and a real reason", async () => {
    await expect(reconcileEmail(untouched, { actorId: "" }, valid)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      reconcileEmail(untouched, { actorId: randomUUID() }, { ...valid, state: "sent" }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { providerId: ["verified_provider_reference_required"] } },
    });
    await expect(
      reconcileEmail(untouched, { actorId: randomUUID() }, { ...valid, reason: "short" }),
    ).rejects.toThrow();
  });
});
