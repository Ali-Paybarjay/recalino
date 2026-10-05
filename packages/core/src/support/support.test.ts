import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { EmailDraftInput, OutboundEmail } from "./contracts";
import { renderEmailRecipients } from "./email";
import { routineReply } from "./feedback";
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
