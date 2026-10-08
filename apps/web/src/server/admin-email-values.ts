import "server-only";
import type { Database } from "@recalino/core/db";
import { readEntitlementAllocation, readLatestEntitlementPeriod } from "@recalino/core/quota";

/** Trusted current values are frozen into the recipient preview, before the owner's approval. */
export async function adminEmailValues(
  db: Database,
  userId: string,
  language: "en" | "fa",
  appLink: string | null,
  manual: Record<string, string> = {},
) {
  const values: Record<string, string> = { ...manual };
  for (const key of [
    "app_link",
    "conversation_link",
    "pilot_end_date",
    "quota_summary",
    "period_text",
  ])
    delete values[key];
  if (appLink) {
    values.app_link = appLink;
    values.conversation_link = new URL("/help", appLink).href;
  }
  const period = await readLatestEntitlementPeriod(db, userId);
  if (period) {
    const allocation = await readEntitlementAllocation(db, userId, period.entitlementId);
    const numbers = new Intl.NumberFormat(language, { maximumFractionDigits: 10 });
    const a = allocation.allocated;
    const labels =
      language === "fa"
        ? ["دقیقهٔ صوت", "صفحهٔ سند", "تولید مجدد", "نویسهٔ گفتار مصنوعی", "MiB فضای ذخیره‌سازی"]
        : ["Audio minutes", "Document pages", "Regenerations", "Speech characters", "Storage MiB"];
    values.quota_summary = [a.audio / 60, a.document, a.regeneration, a.tts, a.storage / 1048576]
      .map((amount, index) => `${labels[index]}: ${numbers.format(amount)}`)
      .join("\n");
    values.pilot_end_date = period.endsAt.toISOString().slice(0, 10);
    values.period_text = `${period.startsAt.toISOString().slice(0, 10)} — ${values.pilot_end_date} (UTC)`;
  }
  return values;
}
