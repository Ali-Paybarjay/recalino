"use client";
import { recoveryCopy } from "../ui/recovery-copy";
import styles from "./recovery.module.css";
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className={styles.global}>
        <title>{recoveryCopy.title} · Recalino</title>
        <main className={styles.page}>
          <section className={styles.card} aria-labelledby="global-error-title">
            <b>Recalino</b>
            <h1 id="global-error-title" className={styles.title}>
              {recoveryCopy.title}
            </h1>
            <p className={styles.description}>{recoveryCopy.description}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.globalButton} onClick={retry}>
                {recoveryCopy.retry}
              </button>
              <a href="/" className={`${styles.globalButton} ${styles.globalLink}`}>
                {recoveryCopy.home}
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
