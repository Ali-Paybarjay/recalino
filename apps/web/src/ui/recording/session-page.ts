type SessionPageInput = {
  /** The page is already a session's recording page. */
  pageSessionId: string | undefined;
  /** The session of the recording this page lists, once /api/classes has answered. */
  recordingSessionId: string | null;
};

/**
 * D107: a recording started on Today gets its session when /api/classes answers, and its page
 * becomes that session's recording page by its address alone (history.replaceState), during
 * capture and after Stop alike. Next.js keeps the address in step without a server request, so
 * there is no loading screen and nothing is announced (PRD-REC-02, PRD-REC-03). Stop never waits
 * on the network either: a class may have none, and a server navigation that fails ends in a
 * full page load, which offline is the browser's error page instead of "Saved on this device".
 * The page itself stays; its way back leads to the session (`sessionPageBack`).
 */
export function sessionAddress(input: SessionPageInput): string | null {
  if (input.pageSessionId || !input.recordingSessionId) return null;
  return `/sessions/${input.recordingSessionId}/record`;
}

/** Changes the address once it differs; never a navigation, whatever the phase or connection. */
export function followSessionAddress(
  input: SessionPageInput,
  page: { location: Pick<Location, "pathname">; history: Pick<History, "replaceState"> },
) {
  const href = sessionAddress(input);
  if (href && page.location.pathname !== href) page.history.replaceState(null, "", href);
}

/**
 * Where the page's way back leads outside capture (UX-02): to the session once the page took its
 * address (with the page's default "Back to session"), otherwise where the page says.
 */
export function sessionPageBack(input: SessionPageInput): string | null {
  return sessionAddress(input) ? `/sessions/${input.recordingSessionId}` : null;
}
