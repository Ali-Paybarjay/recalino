import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { pendingCopy } from "../pending-copy";
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

  it("tells a stopped cleanup to contact the operator, with a link when one is configured", () => {
    const html = render({
      initialPending: pending,
      recoveryStage: "needs_operator",
      operatorMailto: "mailto:operator%40example.org",
    });
    expect(html).toContain(pendingCopy.accountDeletion.needsOperator);
    expect(html).toContain('href="mailto:operator%40example.org"');
    expect(html).not.toContain("Finish deletion");
    expect(html).toContain("Sign out");
    expect(render({ initialPending: pending, recoveryStage: "needs_operator" })).not.toContain(
      "mailto:",
    );
  });

  it("points to the download before the delete options on the normal data page (UX-14)", () => {
    const html = render({});
    expect(html).toContain(pendingCopy.yourData.downloadFirst);
    expect(html).toContain('href="/sessions"');
    expect(html).not.toContain("Sign out");
  });
});
