import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrivacyView } from "./PrivacyView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../recording/RecordingProvider", () => ({
  useRecording: () => ({
    controller: { prepareAccountDeletion: vi.fn() },
    state: { phase: "idle" },
    store: {},
    userId: "10000000-0000-4000-8000-000000000002",
  }),
}));

const requestId = "10000000-0000-4000-8000-000000000009";
const pending = { requestId, kind: "account", state: "acknowledgement_pending" } as const;
const render = (props: Parameters<typeof PrivacyView>[0]) =>
  renderToStaticMarkup(createElement(PrivacyView, props));

// UX-10: what /deletion says depends on whether the deletion receipt is saved.
describe("account deletion recovery page", () => {
  it("still asks to finish when the receipt is not saved, and offers Sign out", () => {
    const html = render({ initialPending: pending, recoveryStage: "journal_unsaved" });
    expect(html).toContain("Finish account deletion");
    expect(html).toContain("Finish deletion");
    expect(html).toContain("Sign out");
  });

  it("shows no Finish deletion once the receipt is saved and cleanup is under way", () => {
    const html = render({ initialPending: pending, recoveryStage: "in_progress" });
    expect(html).toContain("Account deletion requested");
    expect(html).toContain(`Request reference: ${requestId}`);
    expect(html).not.toContain("Finish deletion");
    expect(html).not.toContain("Confirm the request");
    expect(html).toContain("Sign out");
    // "Return to Recalino" only led back to this page until cleanup ended the session.
    expect(html).not.toContain("Return to Recalino");
  });

  it("offers the operator link, not a claim that cleanup is queued, when cleanup is stopped", () => {
    const html = render({
      initialPending: pending,
      recoveryStage: "needs_operator",
      operatorMailto: "mailto:operator%40example.org",
    });
    expect(html).toContain("Account deletion requested");
    expect(html).toContain(`Request reference: ${requestId}`);
    expect(html).not.toContain("Server cleanup has been queued");
    expect(html).toContain("Ask the pilot operator");
    expect(html).toContain('href="mailto:operator%40example.org"');
    expect(html).not.toContain("Finish deletion");
    expect(html).toContain("Sign out");
    const withoutLink = render({ initialPending: pending, recoveryStage: "needs_operator" });
    expect(withoutLink).not.toContain("mailto:");
    expect(withoutLink).not.toContain("Ask the pilot operator");
    expect(withoutLink).toContain("Sign out");
  });

  it("keeps the link to the session list on the normal data page, with no new text (UX-14)", () => {
    const html = render({});
    expect(html).toContain('href="/sessions"');
    expect(html).toContain("Choose a session");
    expect(html).not.toContain("To keep a copy first");
    expect(html).not.toContain("Sign out");
  });
});
