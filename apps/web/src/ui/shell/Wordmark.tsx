import { strings } from "../strings";
import styles from "./Wordmark.module.css";

/** Shared brand mark; standalone pages can load it without the app navigation styles. */
export function Wordmark({ size = "default" }: { size?: "default" | "large" }) {
  return (
    <span className={`${styles.wordmark} ${size === "large" ? styles.wordmarkLarge : ""}`}>
      <span className={styles.wordmarkText}>{strings.brand.wordmark}</span>
      <span className={styles.wordmarkDot} aria-hidden="true" />
    </span>
  );
}
