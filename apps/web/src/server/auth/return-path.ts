/**
 * FR-PLT-001: after sign-in the learner returns only to a path inside the app. Anything else —
 * another site, "//host", a backslash trick or a scheme — falls back to the start page. The check
 * runs again after normalisation, since dot segments can turn "/..//host" into "//host" (SEC-01).
 */
export function safeReturnPath(candidate: string | null | undefined, fallback = "/today"): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  const base = "http://recalino.invalid";
  try {
    const url = new URL(candidate, base);
    if (url.origin !== base) return fallback;
    if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
