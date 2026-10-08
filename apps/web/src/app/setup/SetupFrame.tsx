"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "../../ui/components/Button";
import { experienceCopy } from "../../ui/experience-copy";
import { CaretLeft } from "../../ui/icons";
import { Wordmark } from "../../ui/shell/Wordmark";
import { fill, strings } from "../../ui/strings";
import styles from "./setup.module.css";

/** The required profile choices and optional voice sample share one setup progress indicator. */
export function SetupFrame({
  index,
  onBack,
  children,
}: {
  index: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLDivElement>(null);
  // Each new screen starts at the top with focus on its content (accessibility.md).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per screen change.
  useEffect(() => {
    window.scrollTo(0, 0);
    const heading = headingRef.current?.querySelector<HTMLElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [index]);

  return (
    <main className={styles.page}>
      <header className={styles.wizardHeader}>
        <Wordmark />
        <p className={styles.wizardTitle}>{experienceCopy.setup.title}</p>
        <p className={styles.wizardDescription}>{experienceCopy.setup.description}</p>
      </header>
      <section className={styles.progress} aria-label={experienceCopy.setup.progressLabel}>
        <div className={styles.progressTop}>
          {onBack ? (
            <IconButton
              icon={CaretLeft}
              label={strings.setup.back}
              disabled={index === 0}
              onClick={onBack}
            />
          ) : null}
          <span className={styles.screenName}>{experienceCopy.setup.screens[index]}</span>
          <span className={styles.count}>
            {fill(experienceCopy.setup.progress, {
              step: index + 1,
              total: experienceCopy.setup.screens.length,
            })}
          </span>
        </div>
        <div className={styles.bars} aria-hidden="true">
          {experienceCopy.setup.screens.map((name, barIndex) => (
            <span key={name} className={barIndex <= index ? styles.barOn : styles.bar} />
          ))}
        </div>
      </section>
      <div ref={headingRef} className={styles.body}>
        {children}
      </div>
    </main>
  );
}
