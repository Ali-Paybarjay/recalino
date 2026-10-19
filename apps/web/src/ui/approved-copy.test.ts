import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allowanceHelp } from "./allowance-copy";
import { experienceCopy } from "./experience-copy";
import { cardActionsCopy } from "./workspace/card-actions-copy";
import { workspaceErrors } from "./workspace/error-copy";
import { learningProgressCopy } from "./workspace/learning-progress-copy";
import { privacyCopy } from "./workspace/privacy-copy";

const register = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/design/UI_COPY_PENDING.md"),
  "utf8",
);
// The section where the owner's approval of 2026-10-19 (audit batch 5) is recorded.
const approved = register.slice(
  register.indexOf("## تأیید 2026-10-19 (ممیزی 2026-10-18، دستهٔ ۵"),
  register.indexOf("## تأیید 2026-10-19 — واژگان A"),
);

// The ten texts the owner approved word for word on 2026-10-19. They live in their screen's copy
// module (not in pending-copy.ts) and are recorded here, so neither can drift from the other.
const texts: Array<[string, string, string]> = [
  ["cardActionsCopy.rejected", cardActionsCopy.rejected, "Card rejected"],
  [
    "learningProgressCopy.termsGuidance",
    learningProgressCopy.termsGuidance,
    "Read and accept the updated Terms to continue.",
  ],
  [
    "privacyCopy.needsOperator",
    privacyCopy.needsOperator,
    "Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.",
  ],
  [
    "privacyCopy.downloadFirst",
    privacyCopy.downloadFirst,
    "To keep a copy first, open a session, choose More session tools, then Download notes and cards.",
  ],
  [
    "allowanceHelp.need",
    allowanceHelp.need,
    "The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.",
  ],
  [
    "allowanceHelp.reserved",
    allowanceHelp.reserved,
    "Reserved allowance is held while your material is processed. Only usable published output is charged.",
  ],
  [
    "workspaceErrors.sourcesChanged",
    workspaceErrors.sourcesChanged,
    "The selected sources have changed. Check your session material, then try again.",
  ],
  [
    "experienceCopy.welcome.pilotNote",
    experienceCopy.welcome.pilotNote,
    "Built for a small pilot group. Sign in with Google to start.",
  ],
  [
    "learningProgressCopy.waitEstimate",
    learningProgressCopy.waitEstimate,
    "Most sessions are ready within a few minutes after you stop recording. Longer recordings take longer. You can leave this page.",
  ],
  [
    "learningProgressCopy.notificationQuestion + notificationAction",
    `${learningProgressCopy.notificationQuestion} ${learningProgressCopy.notificationAction}`,
    "Want a message when your notes are ready? Turn on notifications in Settings.",
  ],
];

describe("texts approved by the owner on 2026-10-19", () => {
  it("has a section in the register", () => {
    expect(approved.length).toBeGreaterThan(500);
  });

  it.each(texts)(
    "%s is in the interface and in the register, word for word",
    (key, text, owner) => {
      expect(text).toBe(owner);
      expect(approved).toContain(`«${owner}»`);
      expect(approved).toContain(key.split(" ")[0] as string);
    },
  );
});

// D89 (owner decision 2026-10-19, audit batch 9): the sentence for a result the operator still
// checks (UX-05, `provider_outcome_unresolved`), recorded in its own section of the register.
describe("the provider_outcome_unresolved sentence approved on 2026-10-19", () => {
  const section = register.slice(register.indexOf("## تأیید 2026-10-19 — دستهٔ ۹"));
  it("is in the interface and in the register, word for word", () => {
    const owner =
      "A result is still being checked. Contact the pilot operator before trying again.";
    expect(section.length).toBeGreaterThan(100);
    expect(workspaceErrors.outcomeUnresolved).toBe(owner);
    expect(section).toContain(`«${owner}»`);
    expect(section).toContain("workspaceErrors.outcomeUnresolved");
  });
});
