import type { ReactNode } from "react";
import { Banner } from "../ui/components/Feedback";
import { Icon } from "../ui/components/Icon";
import { ProvenanceBlock } from "../ui/components/Status";
import { experienceCopy } from "../ui/experience-copy";
import { Cards, IdentificationBadge, Play, Warning } from "../ui/icons";
import { Wordmark } from "../ui/shell/Wordmark";
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
      <header className={styles.brand}>
        <Wordmark size="large" />
      </header>
      <div className={styles.layout}>
        <section className={styles.form} aria-labelledby="welcome-title">
          <div className={styles.intro}>
            <p className={styles.eyebrow}>{experienceCopy.welcome.eyebrow}</p>
            <h1 id="welcome-title" className={styles.title}>
              {strings.brand.tagline}
            </h1>
            <p className={styles.description}>{experienceCopy.welcome.description}</p>
          </div>
          <div className={styles.routine}>
            <ol className={styles.loop} aria-label={experienceCopy.welcome.loopLabel}>
              {experienceCopy.welcome.steps.map((step, index) => (
                <li key={step.title} className={styles.loopStep}>
                  <span className={styles.loopNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <span className={styles.loopTitle}>{step.title}</span>
                    <p className={styles.loopDescription}>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.signInPanel}>
            <div className={styles.panelHeading}>
              <h2 className={styles.formTitle}>{experienceCopy.welcome.formTitle}</h2>
              <span className={styles.adultsOnly}>
                <Icon icon={IdentificationBadge} />
                {strings.signIn.adultsOnly}
              </span>
            </div>
            {failed ? (
              <Banner tone="warning" icon={Warning} role="alert">
                {strings.signIn.failed}
              </Banner>
            ) : null}
            <SignInForm next={next} terms={terms} privacy={privacy} />
          </div>
        </section>
        <aside className={styles.example} aria-labelledby="example-heading">
          <p className={styles.eyebrow}>{experienceCopy.welcome.exampleEyebrow}</p>
          <h2 id="example-heading" className={styles.exampleHeading}>
            {experienceCopy.welcome.exampleHeading}
          </h2>
          {/* This is readable sample content, with no interactive or simulated controls. */}
          <div className={styles.exampleCard}>
            <div className={styles.exampleHeader}>
              <span className={styles.exampleTitle}>{strings.signIn.exampleTitle}</span>
              <span className={styles.exampleBadge}>{experienceCopy.welcome.exampleLabel}</span>
            </div>
            <div className={styles.exampleWord}>{strings.signIn.exampleWord}</div>
            <ProvenanceBlock kind="class">
              <p className={styles.exampleText}>{strings.signIn.exampleQuote}</p>
              <span className={styles.exampleSource}>
                <Icon icon={Play} size={14} />
                {strings.signIn.exampleSource}
              </span>
            </ProvenanceBlock>
            <ProvenanceBlock kind="ai">
              <p className={styles.exampleText}>
                {strings.signIn.exampleExplanation.split("{word}")[0]}
                <em>{strings.signIn.exampleWord}</em>
                {strings.signIn.exampleExplanation.split("{word}")[1]}
              </p>
            </ProvenanceBlock>
            <div className={styles.exampleReview}>
              <span className={styles.reviewIcon}>
                <Icon icon={Cards} size={22} />
              </span>
              {strings.signIn.exampleReview}
            </div>
          </div>
          <p className={styles.exampleNote}>{experienceCopy.welcome.exampleNote}</p>
        </aside>
      </div>
    </main>
  );
}
