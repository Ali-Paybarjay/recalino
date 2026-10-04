"use client";
import Link from "next/link";
import { Button } from "../ui/components/Button";
import { recoveryCopy } from "../ui/recovery-copy";
import { Wordmark } from "../ui/shell/AppShell";
import styles from "./recovery.module.css";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="recovery-title">
        <Wordmark />
        <h1 id="recovery-title" className={styles.title}>
          {recoveryCopy.title}
        </h1>
        <p className={styles.description}>{recoveryCopy.description}</p>
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={retry}>
            {recoveryCopy.retry}
          </Button>
          <Link href="/today" className="btn btn-secondary rc-btn-lg">
            {recoveryCopy.today}
          </Link>
        </div>
      </section>
    </main>
  );
}
