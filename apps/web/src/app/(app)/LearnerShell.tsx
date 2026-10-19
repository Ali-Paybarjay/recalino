import { CURRENT_VERSIONS } from "@recalino/core/acc";
import type { ReactNode } from "react";
import type { Learner } from "../../server/auth/learner";
import { legalValues } from "../../server/legal";
import { LegalDocument } from "../../ui/components/LegalDocument";
import { AppShell, type NavId } from "../../ui/shell/AppShell";
import { TermsNotice } from "./TermsNotice";
import { textsChangedOn } from "./texts-changed-on";

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
  reviewDue,
  children,
}: {
  learner: Learner;
  current: NavId;
  /** The page title (PageHeader). */
  header: ReactNode;
  /** Cards due now, for the badge on Review. Only pages that already read the queue pass it. */
  reviewDue?: number;
  children: ReactNode;
}) {
  return (
    <AppShell
      current={current}
      hrefs={NAV_HREFS}
      newClassHref="/sessions/new"
      reviewDue={reviewDue}
    >
      {header}
      <LearnerTermsNotice learner={learner} />
      {children}
    </AppShell>
  );
}

/** Kept on dedicated readers as well as the normal app workspace. */
export function LearnerTermsNotice({ learner }: { learner: Learner }) {
  const values = legalValues();
  return learner.state.pending.terms ? (
    <TermsNotice
      versions={{ terms: CURRENT_VERSIONS.terms, privacy: CURRENT_VERSIONS.privacy }}
      changedOn={textsChangedOn()}
      terms={<LegalDocument id="terms" values={values} />}
      privacy={<LegalDocument id="privacy" values={values} />}
    />
  ) : null;
}
