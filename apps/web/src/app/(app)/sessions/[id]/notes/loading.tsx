import { Wordmark } from "../../../../../ui/shell/Wordmark";
import styles from "../../../../../ui/workspace/SessionNotesReader.module.css";

export default function NotesLoading() {
  return (
    <div className={styles.reader}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Wordmark />
          <span className={styles.readingLabel}>Session notes</span>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.intro} role="status">
          <p className={styles.eyebrow}>Your notebook</p>
          <h1>Opening your session notes…</h1>
        </div>
        <div className={styles.loadingPaper} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </main>
    </div>
  );
}
