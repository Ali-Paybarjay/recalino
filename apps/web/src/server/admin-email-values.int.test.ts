import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { amounts, grantEntitlement, setAllowanceAllocation } from "@recalino/core/quota";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { adminEmailValues } from "./admin-email-values";
import { newLearner } from "./cross-account/learners";

// This suite is deliberately pinned to the local app role; it never follows a cloud DATABASE_URL.
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 3 });
afterAll(() => db.destroy());
const appLink = "https://example.invalid/application?synthetic=1";

async function grantedLearner() {
  const userId = await newLearner(db);
  const startsAt = new Date("2040-02-01T23:30:00-02:00");
  const endsAt = new Date("2040-03-03T00:30:00+02:00");
  const entitlementId = await grantEntitlement(db, {
    userId,
    startsAt,
    endsAt,
    amounts: amounts({ audio: 150, document: 1001, regeneration: 3, tts: 12345, storage: 1572864 }),
    operationKey: randomUUID(),
    actorId: "synthetic-email-values-operator",
    reason: "Synthetic routine-email metadata fixture",
  });
  return { userId, entitlementId };
}

describe("AC-ADM-008/009 trusted bilingual email values", () => {
  it("formats all five allocated units in English and Persian, retaining UTC Gregorian period dates", async () => {
    const { userId } = await grantedLearner();
    const en = await adminEmailValues(db, userId, "en", appLink);
    const fa = await adminEmailValues(db, userId, "fa", appLink);
    expect(en.quota_summary).toBe(
      "Audio minutes: 2.5\nDocument pages: 1,001\nRegenerations: 3\nSpeech characters: 12,345\nStorage MiB: 1.5",
    );
    expect(fa.quota_summary).toBe(
      "دقیقهٔ صوت: ۲٫۵\nصفحهٔ سند: ۱٬۰۰۱\nتولید مجدد: ۳\nنویسهٔ گفتار مصنوعی: ۱۲٬۳۴۵\nMiB فضای ذخیره‌سازی: ۱٫۵",
    );
    for (const value of [en, fa]) {
      expect(value.app_link).toBe(appLink);
      expect(value.conversation_link).toBe("https://example.invalid/help");
      expect(value.pilot_end_date).toBe("2040-03-02");
      expect(value.period_text).toBe("2040-02-02 — 2040-03-02 (UTC)");
    }
  });

  it("preserves reviewed routine fields while refusing all manual replacements for trusted links, period and quota", async () => {
    const { userId } = await grantedLearner();
    const manual = {
      acknowledgement_text: "Reviewed acknowledgement",
      next_step_text: "Reviewed next step",
      conversation_subject: "Reviewed question",
      reply_text: "Reviewed response",
      issue_summary: "Reviewed issue",
      current_status_text: "Reviewed status",
      user_action_text: "Reviewed instruction",
      app_link: "https://untrusted.example.invalid",
      conversation_link: "https://untrusted.example.invalid/thread",
      pilot_end_date: "2099-12-31",
      period_text: "Unlimited forever",
      quota_summary: "Unlimited everything",
    };
    const original = { ...manual };
    const values = await adminEmailValues(db, userId, "en", appLink, manual);
    expect(values).toMatchObject({
      acknowledgement_text: manual.acknowledgement_text,
      next_step_text: manual.next_step_text,
      conversation_subject: manual.conversation_subject,
      reply_text: manual.reply_text,
      issue_summary: manual.issue_summary,
      current_status_text: manual.current_status_text,
      user_action_text: manual.user_action_text,
      app_link: appLink,
      conversation_link: "https://example.invalid/help",
      pilot_end_date: "2040-03-02",
      period_text: "2040-02-02 — 2040-03-02 (UTC)",
    });
    expect(values.quota_summary).not.toContain("Unlimited");
    expect(manual).toEqual(original);
    const persian = await adminEmailValues(db, userId, "fa", appLink, {
      ...manual,
      acknowledgement_text: "متن بازبینی‌شده",
      next_step_text: "گام بعدی بازبینی‌شده",
    });
    expect(persian.acknowledgement_text).toBe("متن بازبینی‌شده");
    expect(persian.next_step_text).toBe("گام بعدی بازبینی‌شده");
    expect(persian.quota_summary).toContain("دقیقهٔ صوت: ۲٫۵");
  });

  it("does not invent an allowance, period or app link when trusted values are absent", async () => {
    const userId = await newLearner(db);
    const values = await adminEmailValues(db, userId, "fa", null, {
      acknowledgement_text: "متن بازبینی‌شده",
      app_link: "https://untrusted.example.invalid",
      conversation_link: "https://untrusted.example.invalid/thread",
      pilot_end_date: "2099-12-31",
      period_text: "Invented period",
      quota_summary: "Invented quota",
    });
    expect(values).toEqual({ acknowledgement_text: "متن بازبینی‌شده" });
  });

  it("uses the account's latest absolute allocation without mutating previously prepared values", async () => {
    const { userId, entitlementId } = await grantedLearner();
    const before = await adminEmailValues(db, userId, "en", appLink);
    await setAllowanceAllocation(db, {
      userId,
      entitlementId,
      amounts: amounts({ audio: 120, document: 2, regeneration: 4, tts: 55, storage: 8388608 }),
      operationKey: randomUUID(),
      actorId: "synthetic-email-values-operator",
      reason: "Synthetic allocation update for routine email",
    });
    const after = await adminEmailValues(db, userId, "en", appLink);
    expect(after.quota_summary).toBe(
      "Audio minutes: 2\nDocument pages: 2\nRegenerations: 4\nSpeech characters: 55\nStorage MiB: 8",
    );
    expect(before.quota_summary).toContain("Audio minutes: 2.5");
    expect(after.period_text).toBe(before.period_text);
  });
});
