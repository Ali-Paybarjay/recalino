import { recoveryCopy } from "../ui/recovery-copy";
import { Wordmark } from "../ui/shell/AppShell";
import styles from "./recovery.module.css";
export default function Loading() {
  return (
    <main className={styles.page}>
      <div className={styles.loading}>
        <Wordmark />
        <p role="status" className={styles.description}>
          {recoveryCopy.loading}
        </p>
        <div aria-hidden="true" className={styles.skeleton}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}
