/** Keep the session notes as the return destination when opening voice settings from a session. */
export function voiceSettingsHref(sessionId: string): string {
  return `/me/voice?returnTo=${encodeURIComponent(`/sessions/${sessionId}/notes`)}`;
}

/** Only session-note paths may override the normal settings destination. */
export function voiceSettingsReturnHref(value: string | string[] | undefined): string {
  return typeof value === "string" &&
    /^\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/notes$/i.test(value)
    ? value
    : "/me";
}
