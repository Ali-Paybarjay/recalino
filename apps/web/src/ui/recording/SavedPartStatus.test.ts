import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureState } from "./controller";
import { SavedPartStatus } from "./SavedPartStatus";

const syncError = "The recorded parts could not be added to your session. Check your connection.";
const render = (phase: CaptureState["phase"], row = {}) =>
  renderToStaticMarkup(
    createElement(SavedPartStatus, {
      row: { status: "saved", awaitingFinalData: false, syncError, ...row },
      phase,
    }),
  );

// UX-11 and PRD-REC-02: a saved earlier part is a separate row while capture goes on, and its
// failed upload must stay silent until the learner presses Stop.
describe("a saved part's upload failure", () => {
  it.each(["starting", "recording", "recovering", "paused"] as const)(
    "raises no alert and shows no text while %s",
    (phase) => {
      const html = render(phase);
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(syncError);
      expect(html).toContain("Saved on this device");
    },
  );

  it.each(["saving", "saved", "idle", "failed"] as const)(
    "is shown as an alert once capture is over (%s)",
    (phase) => {
      const html = render(phase);
      expect(html).toContain('role="alert"');
      expect(html).toContain(syncError);
    },
  );

  it("shows nothing extra for a part without an upload failure", () => {
    for (const phase of ["recording", "idle"] as const) {
      expect(render(phase, { syncError: null })).not.toContain('role="alert"');
    }
  });
});
