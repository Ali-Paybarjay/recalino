import type { NavId } from "../../ui/shell/AppShell";

export const NAV_HREFS: Record<NavId, string> = {
  today: "/today",
  classes: "/sessions",
  review: "/review",
  me: "/me",
};

/**
 * Pages of the (app) segment that draw no app shell: the profile edit page has none, and the
 * session notes reader renders `SessionNotesReader` on its own (with its own `loading.tsx`). Only
 * the reader itself is listed: `/sessions/<id>/notes/versions` uses `LearnerShell` for "classes".
 * The processing screen is not listed: it re-exports the estimate page, which renders
 * `SessionMaterialPage` inside `LearnerShell` for "classes". The recording pages are not listed:
 * they draw the shell with its navigation before Start and after Stop and hide it only while
 * capture is in progress (UX-02, `RecordingShell`).
 */
const WITHOUT_SHELL = [/^\/sessions\/[^/]+\/notes\/?$/, /^\/me\/edit(?:\/|$)/];

/** The recording pages: `/recordings` and `/sessions/<id>/record` (UX-02). */
const RECORDING_PAGE = /^\/(?:recordings|sessions\/[^/]+\/record)(?:\/|$)/;

export function isRecordingPage(pathname: string): boolean {
  return RECORDING_PAGE.test(pathname);
}

/**
 * The navigation item a signed-in path belongs to, as its page passes to `LearnerShell`, or null
 * for a path whose page draws no shell. `loading.tsx` uses it to draw the same navigation while the
 * page loads (UX-08).
 */
export function shellSectionFor(pathname: string): NavId | null {
  if (WITHOUT_SHELL.some((pattern) => pattern.test(pathname))) return null;
  const [first] = pathname.split("/").filter(Boolean);
  switch (first) {
    case "today":
      return "today";
    case "review":
      return "review";
    case "me":
    case "help":
      return "me";
    case "recordings":
    case "sessions":
    case "courses":
    case "cards":
    case "notes":
      return "classes";
    default:
      return null;
  }
}
