/**
 * A saved part's start as a short date and time for the learner ("18 Oct, 14:30"), in the
 * device's time zone. Replaces the browser's long default and its second-by-second digits (UX-11).
 */
export function formatPartDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}
