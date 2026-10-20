/**
 * Your data and account deletion copy approved word for word by the product owner on 2026-10-19
 * (audit batch 5; UX-10 and UX-14) and on 2026-10-20 (`accountHidden`, UX-05, D101), each
 * recorded in docs/design/UI_COPY_PENDING.md and checked by approved-copy.test.ts.
 */
export const privacyCopy = {
  // The deletion receipt while cleanup is under way (UX-05: no "queue" or "server cleanup").
  accountHidden: "Your account and sessions are hidden. The rest of your data is being removed.",
  // The deletion receipt while cleanup waits for the pilot operator; "Request reference: …" follows.
  needsOperator:
    "Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.",
  // First paragraph of Your data: the download is easy to miss on the session page.
  downloadFirst:
    "To keep a copy first, open a session, choose More session tools, then Download notes and cards.",
} as const;
