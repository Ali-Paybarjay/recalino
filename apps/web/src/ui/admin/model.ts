import type { AdminLocale, Dimension, PriceRate, QuotaAmounts } from "./contracts";

export const dimensions: Dimension[] = ["audio", "document", "regeneration", "tts", "storage"];
export type QuotaUnitConfig = { audio: "minutes" | "seconds"; storage: "mib" | "bytes" };
export const friendlyQuotaUnits: QuotaUnitConfig = { audio: "minutes", storage: "mib" };
function quotaMultiplier(dimension: Dimension, units: QuotaUnitConfig): number {
  return dimension === "audio" && units.audio === "minutes"
    ? 60
    : dimension === "storage" && units.storage === "mib"
      ? 1_048_576
      : 1;
}
export function displayQuota(
  value: number,
  dimension: Dimension,
  units = friendlyQuotaUnits,
): number {
  return value / quotaMultiplier(dimension, units);
}
function parseQuotaField(
  input: string,
  dimension: Dimension,
  units: QuotaUnitConfig,
): number | null {
  const value = Number(input.trim());
  if (!input.trim() || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * quotaMultiplier(dimension, units);
  let canonical = scaled;
  if (dimension === "audio" && units.audio === "minutes") {
    const nearest = Math.round(scaled);
    // The division 31 / 60 produces a decimal whose multiplication is one ULP above 31.
    // A bounded relative tolerance handles that noise, never a meaningful fractional second.
    const tolerance = Math.min(1e-7, Number.EPSILON * Math.abs(scaled) * 2);
    if (Math.abs(scaled - nearest) > tolerance) return null;
    canonical = nearest;
  }
  return Number.isSafeInteger(canonical) && canonical >= 0 ? canonical : null;
}
export function parseQuota(
  values: Record<Dimension, string>,
  units = friendlyQuotaUnits,
): QuotaAmounts | null {
  const parsed = {} as QuotaAmounts;
  for (const dimension of dimensions) {
    const value = parseQuotaField(values[dimension], dimension, units);
    if (value === null) return null;
    parsed[dimension] = value;
  }
  return parsed;
}
export function quotaFields(
  values: QuotaAmounts,
  units = friendlyQuotaUnits,
): Record<Dimension, string> {
  return Object.fromEntries(
    dimensions.map((key) => [key, String(displayQuota(values[key], key, units))]),
  ) as Record<Dimension, string>;
}
/** Friendly units are preferred; an amount that cannot round-trip uses its exact base unit. */
export function exactQuotaUnits(
  amounts: QuotaAmounts,
  preferred = friendlyQuotaUnits,
): QuotaUnitConfig {
  const units = { ...preferred };
  for (const dimension of ["audio", "storage"] as const) {
    const displayed = String(displayQuota(amounts[dimension], dimension, units));
    if (parseQuotaField(displayed, dimension, units) !== amounts[dimension])
      if (dimension === "audio") units.audio = "seconds";
      else units.storage = "bytes";
  }
  return units;
}
/** Refuse a lossy toggle while preserving every other form field verbatim. */
export function switchQuotaFieldUnit(
  input: string,
  dimension: "audio" | "storage",
  from: QuotaUnitConfig,
  to: QuotaUnitConfig,
): string | null {
  const canonical = parseQuotaField(input, dimension, from);
  if (canonical === null) return null;
  const displayed = String(displayQuota(canonical, dimension, to));
  return parseQuotaField(displayed, dimension, to) === canonical ? displayed : null;
}
export function availableQuota(allocated: number, consumed: number, reserved: number): number {
  return Math.max(0, allocated - consumed - reserved);
}
export function formatNumber(value: number, locale: AdminLocale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    maximumFractionDigits: 6,
  }).format(value);
}
export function formatMoney(micros: number, locale: AdminLocale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
}
function formatUnit(value: number, unit: string, locale: AdminLocale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}
/** OPS-02: decimal megabytes, the unit of the Supabase plan's size limit (ADR-0001). */
export function formatMegabytes(bytes: number, locale: AdminLocale): string {
  return formatUnit(bytes / 1_000_000, "megabyte", locale);
}
/** OPS-02: a wait in whole minutes under an hour, then hours under two days, then days. */
export function formatWait(milliseconds: number, locale: AdminLocale): string {
  const minutes = Math.max(0, milliseconds) / 60_000;
  if (minutes < 60) return formatUnit(Math.floor(minutes), "minute", locale);
  if (minutes < 48 * 60) return formatUnit(minutes / 60, "hour", locale);
  return formatUnit(minutes / 1440, "day", locale);
}
export function dollarsToMicros(value: string): number | null {
  if (!value.trim()) return null;
  const dollars = Number(value);
  const micros = Math.round(dollars * 1_000_000);
  return Number.isFinite(dollars) &&
    dollars >= 0 &&
    Number.isSafeInteger(micros) &&
    Math.abs(micros / 1_000_000 - dollars) < 1e-10
    ? micros
    : null;
}
/** One billing basis per stage/model, except paired input/output token prices. */
export function rateConfigurationProblem(rates: PriceRate[]): "duplicate" | "ambiguous" | null {
  const seen = new Set<string>();
  const groups = new Map<string, Set<PriceRate["unit"]>>();
  for (const rate of rates) {
    const groupKey = `${rate.stage}:${rate.model.trim()}`;
    const rowKey = `${groupKey}:${rate.unit}`;
    if (seen.has(rowKey)) return "duplicate";
    seen.add(rowKey);
    const units = groups.get(groupKey) ?? new Set<PriceRate["unit"]>();
    units.add(rate.unit);
    groups.set(groupKey, units);
    if (units.size > 1 && [...units].some((unit) => !unit.endsWith("million_tokens")))
      return "ambiguous";
  }
  return null;
}
const automaticVariables = new Set([
  "first_name",
  "account_email",
  "app_link",
  "conversation_link",
  "pilot_end_date",
  "quota_summary",
  "period_text",
]);
export function manualTemplateVariables(
  subject: string,
  body: string,
  defaults: Record<string, string> = {},
): string[] {
  return [
    ...new Set(
      [...`${subject}\n${body}`.matchAll(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ].filter((name) => name && !automaticVariables.has(name) && !defaults[name]?.trim());
}
/** Show ready template prose while keeping recipient-specific substitutions for the server. */
export function readableTemplateText(text: string, defaults: Record<string, string> = {}): string {
  return text.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g, (placeholder, name: string) =>
    defaults[name]?.trim() ? defaults[name] : placeholder,
  );
}
/** Keep an optional owner note above the template's existing team sign-off. */
export function emailBodyWithNote(body: string, note: string): string {
  const text = note.trim();
  if (!text) return body;
  const signOff = body.lastIndexOf("\n\n");
  if (signOff >= 0 && /(?:The Recalino team|تیم ریکالینو)\s*$/.test(body))
    return `${body.slice(0, signOff)}\n\n${text}${body.slice(signOff)}`;
  return `${body}\n\n${text}`;
}
