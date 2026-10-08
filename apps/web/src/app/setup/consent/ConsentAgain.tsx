"use client";

import { useRouter } from "next/navigation";
import { accountCopy } from "../../../ui/account-copy";
import { Wordmark } from "../../../ui/shell/Wordmark";
import { fill } from "../../../ui/strings";
import { acceptTexts } from "../api";
import styles from "../setup.module.css";
import { ConsentStep } from "../steps";

/** D33 rule 3: a new version of the recording consent is shown once, then Today. */
export function ConsentAgain({ version }: { version: string }) {
  const router = useRouter();
  return (
    <main className={styles.page}>
      <header className={styles.wizardHeader}>
        <Wordmark />
        <h1 className={styles.wizardTitle}>{accountCopy.renewedConsent.title}</h1>
        <p className={styles.wizardDescription}>{accountCopy.renewedConsent.description}</p>
        <p className={styles.small}>{fill(accountCopy.renewedConsent.version, { version })}</p>
      </header>
      <div className={styles.body}>
        <ConsentStep
          headingLevel={2}
          actionLabel={accountCopy.accept}
          onSubmit={async () => {
            await acceptTexts([{ document: "recording-consent", version }]);
            router.replace("/today");
          }}
        />
      </div>
    </main>
  );
}
