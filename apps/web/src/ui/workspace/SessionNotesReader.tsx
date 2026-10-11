"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";
import { Icon } from "../components/Icon";
import { CalendarBlank, Cards, CaretLeft, CheckCircle, FileText } from "../icons";
import { Wordmark } from "../shell/Wordmark";
import styles from "./SessionNotesReader.module.css";

/** A dedicated reading page with document scrolling, independent of the workspace shell. */
export function SessionNotesReader({
  sessionId,
  title,
  courseName,
  classDate,
  topics = [],
  hasNotes,
  revisionNumber,
  canOpenCards = revisionNumber !== undefined,
  backHref = `/sessions/${sessionId}`,
  cardsHref = `/sessions/${sessionId}/cards`,
  children,
}: {
  sessionId: string;
  title: string;
  courseName?: string;
  classDate?: string;
  topics?: readonly string[];
  hasNotes: boolean;
  revisionNumber?: number;
  canOpenCards?: boolean;
  backHref?: string;
  cardsHref?: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // A new reader starts at its own heading. Background note refreshes keep the reading position.
    if (!sessionId) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [sessionId]);
  const date =
    classDate && /^\d{4}-\d{2}-\d{2}$/.test(classDate)
      ? new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${classDate}T12:00:00Z`))
      : classDate;
  return (
    <div className={styles.reader} data-session-reader>
      <a href="#content" className={styles.skip}>
        Skip to session notes
      </a>
      <header className={styles.topbar}>
        <nav className={styles.topbarInner} aria-label="Notes navigation">
          <Link
            href={backHref}
            prefetch={false}
            className={styles.back}
            aria-label="Back to session"
          >
            <Icon icon={CaretLeft} size={20} />
            <span className={styles.backLong}>Back to session</span>
            <span className={styles.backShort} aria-hidden="true">
              Back
            </span>
          </Link>
          <span className={styles.brand}>
            <Wordmark />
          </span>
          <span className={styles.mobileLabel}>Session notes</span>
          {canOpenCards ? (
            <Link href={cardsHref} prefetch={false} className={styles.practice}>
              <Icon icon={Cards} size={20} />
              <span>Flashcards</span>
            </Link>
          ) : (
            <span className={styles.readingLabel}>Your notebook</span>
          )}
        </nav>
      </header>
      <main id="content" className={styles.main} tabIndex={-1}>
        <header className={styles.intro}>
          <div className={styles.introTop}>
            <p className={styles.eyebrow}>
              <Icon icon={FileText} size={18} />
              Session notes
            </p>
            {hasNotes ? (
              <span className={styles.saved}>
                <Icon icon={CheckCircle} size={16} />
                {revisionNumber ? `Saved · Version ${revisionNumber}` : "Lesson preview"}
              </span>
            ) : null}
          </div>
          <h1 ref={heading} tabIndex={-1} dir="auto">
            {title}
          </h1>
          <div className={styles.metadata}>
            {courseName ? <span dir="auto">{courseName}</span> : null}
            {date ? (
              <span>
                <Icon icon={CalendarBlank} size={16} />
                <time dateTime={classDate}>{date}</time>
              </span>
            ) : null}
          </div>
          {topics.length ? (
            <ul className={styles.topics} aria-label="Lesson topics">
              {topics.slice(0, 4).map((topic) => (
                <li key={topic} dir="auto">
                  {topic}
                </li>
              ))}
              {topics.length > 4 ? <li>+{topics.length - 4} more</li> : null}
            </ul>
          ) : null}
        </header>
        <div className={styles.body}>{children}</div>
        <footer className={styles.footer}>
          <span>One session. Everything you learned.</span>
          <Link href={backHref} prefetch={false}>
            <Icon icon={CaretLeft} size={16} />
            Back to session
          </Link>
        </footer>
      </main>
    </div>
  );
}
