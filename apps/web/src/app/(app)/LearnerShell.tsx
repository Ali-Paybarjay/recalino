import { CURRENT_VERSIONS } from "@recalino/core/acc";
import type { ReactNode } from "react";
import { LEGAL_TEXTS } from "../../legal/texts.generated";
import type { Learner } from "../../server/auth/learner";
import { legalValues } from "../../server/legal";
import { LegalDocument } from "../../ui/components/LegalDocument";
import { AppShell, type NavId } from "../../ui/shell/AppShell";
import { TermsNotice } from "./TermsNotice";

/** The newer publication date of the two texts, e.g. "1 Oct" (frame G3). */
function textsChangedOn(): string {
  const latest = [LEGAL_TEXTS.terms.published, LEGAL_TEXTS.privacy.published].sort().at(-1) ?? "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${latest}T00:00:00Z`));
}

export const NAV_HREFS: Record<NavId, string> = {
  today: "/today",
  classes: "/sessions",
  review: "/review",
  me: "/me",
};

/**
 * The signed-in pages: the app shell, plus the calm notice about changed Terms on every page until
 * the learner accepts them (FR-ACC-007). As in frame G3, the notice sits under the page title.
 * Reading and review keep working meanwhile.
 */
export function LearnerShell({
  learner,
  current,
  header,
  children,
}: {
  learner: Learner;
  current: NavId;
  /** The page title (PageHeader). */
  header: ReactNode;
  children: ReactNode;
}) {
  const values = legalValues();
  return (
    <AppShell current={current} hrefs={NAV_HREFS} newClassHref="/sessions/new">
      {header}
      {learner.state.pending.terms ? (
        <TermsNotice
          versions={{ terms: CURRENT_VERSIONS.terms, privacy: CURRENT_VERSIONS.privacy }}
          changedOn={textsChangedOn()}
          terms={<LegalDocument id="terms" values={values} />}
          privacy={<LegalDocument id="privacy" values={values} />}
        />
      ) : null}
      {children}
    </AppShell>
  );
}
