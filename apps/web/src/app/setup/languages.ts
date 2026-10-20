// Language and time-zone names from the runtime's Intl data (D31 rule 8: no language data in the
// bundle). Client components call these after hydration, so server and browser never disagree;
// Settings, a server component, gets Node's names.

export type FirstLanguage = { code: string; experimental: boolean };

export type LanguageName = { code: string; english: string; native: string | undefined };

export function languageName(code: string): LanguageName {
  const english =
    new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" }).of(code) ??
    code;
  let native: string | undefined;
  try {
    native = new Intl.DisplayNames([code], { type: "language" }).of(code);
  } catch {
    native = undefined;
  }
  return { code, english, native: native && native !== english ? native : undefined };
}

/** Names the browser knows, sorted by English name; codes it can't name are left out. */
export function languageNames(codes: readonly string[]): LanguageName[] {
  return codes
    .map(languageName)
    .filter((name) => name.english !== name.code)
    .sort((a, b) => a.english.localeCompare(b.english, "en"));
}

export { timeZoneCity } from "../../ui/time-zone";

type LocaleWithZones = Intl.Locale & { getTimeZones?: () => string[]; timeZones?: string[] };

function regionZones(code: string): string[] | undefined {
  const locale = new Intl.Locale(`und-${code}`) as LocaleWithZones;
  // Chrome before 130 has the older getter instead of the method.
  return locale.getTimeZones?.() ?? locale.timeZones;
}

/**
 * The short country name for a zone, from the browser's own data: "Europe/London" → "UK" (frame
 * A2.6: "London (UK)"). Null when the browser can't tell, e.g. Firefox, or for a zone like UTC.
 */
export function timeZoneCountry(zone: string): string | null {
  if (regionZones("GB") === undefined) return null;
  const regions = new Intl.DisplayNames(["en"], {
    type: "region",
    style: "short",
    fallback: "none",
  });
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const name = regions.of(code);
      if (name !== undefined && regionZones(code)?.includes(zone)) return name;
    }
  }
  return null;
}

export function timeZoneNow(zone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

/** "GMT+1" for Settings (frame G3: "London (GMT+1)"). */
export function timeZoneOffset(zone: string, now = new Date()): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? "";
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function allTimeZones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}
