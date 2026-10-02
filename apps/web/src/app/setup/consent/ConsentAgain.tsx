"use client";

import { useRouter } from "next/navigation";
import { acceptTexts } from "../api";
import styles from "../setup.module.css";
import { ConsentStep } from "../steps";

/** D33 rule 3: a new version of the recording consent is shown once, then Today. */
export function ConsentAgain({ version }: { version: string }) {
  const router = useRouter();
  return (
    <main className={styles.page}>
      <div className={styles.body}>
        <ConsentStep
          onSubmit={async () => {
            await acceptTexts([{ document: "recording-consent", version }]);
            router.replace("/today");
          }}
        />
      </div>
    </main>
  );
}
