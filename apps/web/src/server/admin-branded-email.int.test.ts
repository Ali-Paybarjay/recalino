import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import {
  DEFAULT_EMAIL_TEMPLATES,
  getEmailDraft,
  getReplyDraft,
  listEmailTemplates,
  saveEmailTemplate,
  submitFeedback,
} from "@recalino/core/support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../../../packages/core/test/local-db";
import type { AdminResult } from "../ui/admin/contracts";
import { adminHandler } from "./admin-routes";
import { defineRoute, type SessionProvider } from "./api";
import { newLearner, requestAs } from "./cross-account/learners";
import { ROUTES } from "./routes";
import { routeDeps } from "./test-support";

const contacts = vi.hoisted(
  () => new Map<string, { email: string; name: string; language: "en" | "fa" }>(),
);
vi.mock("./admin-directory", () => ({
  adminDirectory: () => ({
    getUser: async (id: string) => {
      const value = contacts.get(id);
      if (!value) throw new Error("Unknown synthetic contact");
      return value;
    },
  }),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(), // Synthetic approval never dispatches a real message.
}));

const databaseUrl = testDatabaseUrl();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname))
  throw new Error("Branded email fixtures require the local test database.");
const db = createDatabase(databaseUrl);
const provision = createDatabase(LOCAL_ADMIN_DATABASE_URL);
let owner: string, learner: string;
let previous: { user_id: string; enabled: boolean; created_at: Date } | undefined;
const sessions: SessionProvider = {
  getSession: async (request) => {
    const userId = request.headers.get("x-test-user");
    return userId ? { userId } : null;
  },
};
const route = defineRoute(ROUTES.admin, adminHandler(), {
  ...routeDeps(db),
  adminSessions: sessions,
});
function post(action: string, input: unknown, operationKey = randomUUID()) {
  const request = requestAs(owner, "/api/admin", "POST", { action, input });
  request.headers.set("idempotency-key", operationKey);
  return request;
}
beforeAll(async () => {
  vi.stubEnv("RECALINO_PUBLIC_APP_URL", "https://recalino.example.test");
  [owner, learner] = await Promise.all([newLearner(db), newLearner(db)]);
  contacts.set(learner, {
    email: `synthetic-${learner}@example.test`,
    name: "Synthetic learner",
    language: "fa",
  });
  previous = (
    await sql<{
      user_id: string;
      enabled: boolean;
      created_at: Date;
    }>`select user_id,enabled,created_at from plt.admin_owner`.execute(provision)
  ).rows[0];
  await sql`insert into plt.admin_owner(singleton,user_id,enabled) values(true,${owner}::uuid,true) on conflict(singleton) do update set user_id=excluded.user_id,enabled=true`.execute(
    provision,
  );
});
afterAll(async () => {
  try {
    if (previous)
      await sql`update plt.admin_owner set user_id=${previous.user_id}::uuid,enabled=${previous.enabled},created_at=${previous.created_at}`.execute(
        provision,
      );
    else if (owner)
      await sql`delete from plt.admin_owner where user_id=${owner}::uuid`.execute(provision);
  } finally {
    vi.unstubAllEnvs();
    await Promise.all([db.destroy(), provision.destroy()]);
  }
});

describe("owner-reviewed branded email gateway", () => {
  it("ignores empty or invalid unused locale fields but returns precise errors when that locale is needed", async () => {
    const originalContact = contacts.get(learner);
    if (!originalContact) throw new Error("Synthetic contact missing");
    const input = {
      userIds: [learner],
      templateId: null,
      language: "recipient",
      localizedContent: {
        en: { subject: "Ready English email", body: "Reviewed English text" },
        fa: { subject: "", body: "" },
      },
      localizedPresentation: { en: { action: null }, fa: { action: { label: "", url: "" } } },
    };
    try {
      contacts.set(learner, { ...originalContact, language: "en" });
      const ready = await route(post("email.preview", input));
      expect(ready.status).toBe(200);
      expect(((await ready.json()) as AdminResult).preview?.recipients[0]?.subject).toBe(
        "Ready English email",
      );
      contacts.set(learner, originalContact);
      const missingText = await route(post("email.preview", input));
      expect(missingText.status).toBe(400);
      expect((await missingText.json()).error.details.fields).toEqual({
        "localizedContent.fa.subject": ["required"],
      });
      input.localizedContent.fa = { subject: "موضوع آماده", body: "متن آماده" };
      const missingAction = await route(post("email.preview", input));
      expect(missingAction.status).toBe(400);
      expect((await missingAction.json()).error.details.fields).toEqual({
        "localizedPresentation.fa.action.label": ["too_small"],
        "localizedPresentation.fa.action.url": ["too_small"],
      });
      input.localizedPresentation.fa.action = { label: "ورود", url: "javascript:alert(1)" };
      const unsafeAction = await route(post("email.preview", input));
      expect(unsafeAction.status).toBe(400);
      expect((await unsafeAction.json()).error.details.fields).toEqual({
        "localizedPresentation.fa.action.url": ["https_action_url_required"],
      });
      contacts.set(learner, { ...originalContact, language: "en" });
      expect((await route(post("email.preview", input))).status).toBe(200);
      input.localizedPresentation.fa.action.url = "x".repeat(2049);
      const oversized = await route(post("email.preview", input));
      expect(oversized.status).toBe(400);
      expect((await oversized.json()).error.details.fields).toEqual({
        "localizedPresentation.fa.action.url": ["too_big"],
      });
    } finally {
      contacts.set(learner, originalContact);
    }
  });
  it("prepares an unchanged routine invitation with no manual fields or unused translation work", async () => {
    const template = DEFAULT_EMAIL_TEMPLATES.find((item) => item.id === "pilot_invitation");
    if (!template) throw new Error("Invitation template missing");
    const response = await route(
      post("email.preview", {
        userIds: [learner],
        templateId: template.id,
        language: "recipient",
        localizedContent: {
          fa: { subject: template.content.fa.subject, body: template.content.fa.body },
          en: { subject: "", body: "" },
        },
        localizedVariables: { fa: { next_step_text: "" } },
      }),
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as AdminResult;
    const recipient = result.preview?.recipients[0];
    expect(recipient?.language).toBe("fa");
    expect(recipient?.body).toContain(template.variableDefaults?.fa?.next_step_text);
    expect(recipient?.body).not.toContain("{{");
    const draftId = result.preview?.previewId.split(":")[0] ?? "";
    const draft = await getEmailDraft(db, { actorId: owner }, draftId);
    expect(draft.recipients[0]?.missingVariables).toEqual([]);
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select("id")
        .where("draft_id", "=", draftId)
        .execute(),
    ).toHaveLength(0);
  });
  it("uses verified template translations for missing locale edits and rejects real missing data with specific fields", async () => {
    const enLearner = await newLearner(db);
    contacts.set(enLearner, {
      email: `synthetic-${enLearner}@example.test`,
      name: "Synthetic English learner",
      language: "en",
    });
    const ready = await route(
      post("email.preview", {
        userIds: [learner, enLearner],
        templateId: "pilot_invitation",
        language: "recipient",
        subject: "موضوع فقط فارسی",
        body: "متن فقط فارسی",
        localizedContent: { fa: { subject: "موضوع فقط فارسی", body: "متن فقط فارسی" } },
        localizedPresentation: { fa: { action: null } },
        presentation: { headline: "عنوان فقط فارسی", action: null },
      }),
    );
    expect(ready.status).toBe(200);
    const recipients = ((await ready.json()) as AdminResult).preview?.recipients;
    expect(recipients?.find((item) => item.language === "en")?.subject).toBe(
      "You’re invited to try Recalino",
    );
    expect(recipients?.find((item) => item.language === "en")?.presentation?.action?.label).toBe(
      "Open Recalino",
    );
    const before = await db
      .selectFrom("support.email_draft")
      .select("id")
      .where("actor_id", "=", owner)
      .execute();
    const missing = await route(
      post("email.preview", {
        userIds: [learner],
        templateId: "pilot_invitation",
        language: "recipient",
        localizedContent: { fa: { subject: "موضوع آماده", body: "{{custom_note2}}" } },
      }),
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.details.fields).toEqual({
      "localizedVariables.fa.custom_note2": ["required_template_variable"],
    });
    expect(
      await db
        .selectFrom("support.email_draft")
        .select("id")
        .where("actor_id", "=", owner)
        .execute(),
    ).toEqual(before);
    const notice = await route(
      post("email.preview", {
        userIds: [learner],
        templateId: "service_notice",
        language: "recipient",
      }),
    );
    expect(notice.status).toBe(400);
    expect((await notice.json()).error.details.fields).toEqual({
      "localizedVariables.fa.current_status_text": ["required_template_variable"],
      "localizedVariables.fa.issue_summary": ["required_template_variable"],
    });
  });
  it("replays the frozen preview after a template edit rather than validating new unseen text", async () => {
    const original = (await listEmailTemplates(db)).find((item) => item.id === "pilot_followup");
    if (!original) throw new Error("Follow-up template missing");
    const input = { userIds: [learner], templateId: original.id, language: "recipient" };
    const operationKey = randomUUID();
    const first = await route(post("email.preview", input, operationKey));
    expect(first.status).toBe(200);
    const frozen = ((await first.json()) as AdminResult).preview;
    const revised = await saveEmailTemplate(
      db,
      { actorId: owner },
      {
        id: original.id,
        expectedVersion: original.version,
        content: {
          en: { subject: "Synthetic revised template", body: "{{new_required_note}}" },
          fa: { subject: "قالب بازبینی‌شدهٔ مصنوعی", body: "{{new_required_note}}" },
        },
        reason: "Synthetic idempotent preview regression",
      },
    );
    try {
      const replay = await route(post("email.preview", input, operationKey));
      expect(replay.status).toBe(200);
      expect(((await replay.json()) as AdminResult).preview).toEqual(frozen);
      const fresh = await route(post("email.preview", input));
      expect(fresh.status).toBe(400);
      expect((await fresh.json()).error.details.fields).toEqual({
        "localizedVariables.fa.new_required_note": ["required_template_variable"],
      });
    } finally {
      await saveEmailTemplate(
        db,
        { actorId: owner },
        {
          id: original.id,
          expectedVersion: revised.version,
          content: original.content,
          reason: "Restore the synthetic template fixture",
        },
      );
    }
  });
  it("returns an escaped frozen recipient design without queueing mail and rejects unsafe links", async () => {
    const input = {
      userIds: [learner],
      templateId: null,
      language: "fa",
      subject: "موضوع آزمایشی",
      body: "سلام {{first_name}}\n<script>plain text</script>",
      presentation: {
        headline: "یادگیری با ریکالینو",
        preheader: "پیش‌نمایش آزمایشی",
        action: { label: "ورود", url: "{{app_link}}" },
      },
      reason: "Synthetic branded preview verification",
    };
    const response = await route(post("email.preview", input));
    expect(response.status).toBe(200);
    const result = (await response.json()) as AdminResult;
    const recipient = result.preview?.recipients[0];
    expect(recipient).toMatchObject({
      language: "fa",
      presentation: {
        headline: "یادگیری با ریکالینو",
        action: { label: "ورود", url: "https://recalino.example.test/" },
      },
    });
    expect(recipient?.presentation?.previewHtml).toContain('dir="rtl"');
    expect(recipient?.presentation?.previewHtml).toContain("data:image/png;base64,");
    expect(recipient?.presentation?.previewHtml).toContain(
      "&lt;script&gt;plain text&lt;/script&gt;",
    );
    expect(recipient?.presentation?.previewHtml).not.toContain("<script>");
    const draftId = result.preview?.previewId.split(":")[0] ?? "";
    const frozen = await getEmailDraft(db, { actorId: owner }, draftId);
    expect(frozen.recipients[0]?.presentation?.headline).toBe(recipient?.presentation?.headline);
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select("id")
        .where("draft_id", "=", draftId)
        .execute(),
    ).toHaveLength(0);
    const unsafe = await route(
      post("email.preview", {
        ...input,
        presentation: { action: { label: "Unsafe", url: "javascript:alert(1)" } },
      }),
    );
    expect(unsafe.status).toBe(400);
  });
  it("approves the exact reply design by revision and refuses a changed verified recipient", async () => {
    const thread = await submitFeedback(
      db,
      { userId: learner, requestId: randomUUID() },
      {
        operationKey: randomUUID(),
        category: "question",
        subject: "Synthetic reply",
        body: "A synthetic question.",
        emailNotification: true,
      },
    );
    const response = await route(
      post("feedback.preview", {
        threadId: thread.id,
        body: "پاسخ دقیق تأییدشده",
        language: "fa",
        notifyByEmail: true,
        presentation: {
          headline: "پاسخ ریکالینو",
          action: { label: "مشاهدهٔ گفت‌وگو", url: "{{conversation_link}}" },
        },
      }),
    );
    expect(response.status).toBe(200);
    const preview = ((await response.json()) as AdminResult).replyPreview;
    expect(preview?.emailPreview?.presentation?.action?.url).toBe(
      `https://recalino.example.test/help/${thread.id}`,
    );
    if (!preview) throw new Error("Reply preview missing");
    const frozen = await getReplyDraft(db, { actorId: owner }, preview.draftId);
    const originalContact = contacts.get(learner);
    if (!originalContact) throw new Error("Synthetic contact missing");
    const approval = {
      threadId: thread.id,
      draftId: preview.draftId,
      revision: preview.revision,
      notifyByEmail: true,
    };
    contacts.set(learner, { ...originalContact, email: "changed@example.test" });
    expect((await route(post("feedback.reply", approval))).status).toBe(409);
    contacts.set(learner, originalContact);
    const operationKey = randomUUID();
    const request = post("feedback.reply", approval, operationKey);
    expect((await route(request.clone())).status).toBe(200);
    expect((await route(request.clone())).status).toBe(200);
    const outbox = (
      await sql<{
        presentation: unknown;
        body: string;
      }>`select presentation,body from support.email_outbox where thread_id=${thread.id}::uuid`.execute(
        db,
      )
    ).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.presentation).toEqual(frozen.emailPreview?.presentation);
    expect(outbox[0]?.body).toBe(frozen.emailPreview?.body);
    const receipt = await db
      .selectFrom("ops.admin_operation")
      .select("result")
      .where("actor_id", "=", owner)
      .where("operation_key", "=", operationKey)
      .executeTakeFirstOrThrow();
    expect(receipt.result).toEqual({ ok: true });
    expect(JSON.stringify(receipt)).not.toContain("پاسخ دقیق تأییدشده");
    expect(
      (await route(post("feedback.reply", { ...approval, body: "Unreviewed edit" }))).status,
    ).toBe(400);
  });
});
