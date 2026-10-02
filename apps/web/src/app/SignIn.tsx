import type { ReactNode } from "react";
import { Banner } from "../ui/components/Feedback";
import { Icon } from "../ui/components/Icon";
import { ProvenanceBlock, SourceChip } from "../ui/components/Status";
import { Cards, IdentificationBadge, Warning } from "../ui/icons";
import { Wordmark } from "../ui/shell/AppShell";
import { strings } from "../ui/strings";
import styles from "./SignIn.module.css";
import { SignInForm } from "./SignInForm";

type SignInProps = {
  /** The return from Google failed or was cancelled (frame A1-failed). */
  failed: boolean;
  /** Where to go after sign-in; already checked to be a path in the app. */
  next: string;
  terms: ReactNode;
  privacy: ReactNode;
};

/**
 * A1 — Welcome / sign in (FR-ACC-001, FR-ACC-002). Rendered on the server; only the form and
 * its sheets run in the browser, which keeps the first page light (D31 rule 8).
 */
export function SignIn({ failed, next, terms, privacy }: SignInProps) {
  return (
    <main className={styles.page}>
      <section className={styles.form} aria-labelledby="welcome-title">
        <Wordmark size="large" />
        <div className={styles.spacerDesktop} />
        <h1 id="welcome-title" className={styles.title}>
          {strings.brand.tagline}
        </h1>
        <div className={styles.adultsOnly}>
          <Icon icon={IdentificationBadge} />
          {strings.signIn.adultsOnly}
        </div>
        {failed ? (
          <Banner tone="warning" icon={Warning} role="alert">
            {strings.signIn.failed}
          </Banner>
        ) : null}
        <div className={styles.spacerMobile} />
        <SignInForm next={next} terms={terms} privacy={privacy} />
        <div className={styles.spacerDesktop} />
      </section>
      {/* A static example built from UI components (A1-desktop); inert, so nothing in it is
          focusable or read out. */}
      <aside className={styles.example} inert>
        <div className={styles.exampleCard}>
          <div className={styles.exampleTitle}>{strings.signIn.exampleTitle}</div>
          <div className={styles.exampleWord}>{strings.signIn.exampleWord}</div>
          <ProvenanceBlock kind="class">
            <p className={styles.exampleText}>{strings.signIn.exampleQuote}</p>
            <SourceChip source={{ type: "audio", label: strings.signIn.exampleSource }} />
          </ProvenanceBlock>
          <ProvenanceBlock kind="ai">
            <p className={styles.exampleText}>
              {strings.signIn.exampleExplanation.split("{word}")[0]}
              <em>{strings.signIn.exampleWord}</em>
              {strings.signIn.exampleExplanation.split("{word}")[1]}
            </p>
          </ProvenanceBlock>
          <div className={styles.exampleReview}>
            <Icon icon={Cards} />
            {strings.signIn.exampleReview}
          </div>
        </div>
      </aside>
    </main>
  );
}
