// FR-PLT-013: everything is stored in UTC; local time exists only for display and study days.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Unknown or invalid zones fall back to UTC; `fallback` tells the UI to ask the learner. */
export function resolveTimeZone(timeZone: string | null | undefined): {
  timeZone: string;
  fallback: boolean;
} {
  if (timeZone && isValidTimeZone(timeZone)) return { timeZone, fallback: false };
  return { timeZone: "UTC", fallback: true };
}

/**
 * The learner's study day as "YYYY-MM-DD". A day starts at `dayStartHour` local wall-clock time,
 * so a review at 01:30 still belongs to the previous day. Wall-clock (not elapsed) hours keep the
 * boundary right on daylight-saving change days.
 */
export function studyDay(instant: Date, timeZone: string, dayStartHour: number): string {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour", number>;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < dayStartHour) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
