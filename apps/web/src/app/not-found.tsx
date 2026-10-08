import Link from "next/link";
import { recoveryCopy } from "../ui/recovery-copy";
import { Wordmark } from "../ui/shell/Wordmark";
import styles from "./recovery.module.css";
export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="not-found-title">
        <Wordmark />
        <h1 id="not-found-title" className={styles.title}>
          {recoveryCopy.missing}
        </h1>
        <p className={styles.description}>{recoveryCopy.missingDescription}</p>
        <Link href="/today" className="btn btn-primary rc-btn-lg">
          {recoveryCopy.today}
        </Link>
      </section>
    </main>
  );
}
