import Link from "next/link";
import { Cards, CaretRight, FileText, FolderSimple, Lightbulb, UserCircle } from "../icons";
import { strings } from "../strings";
import { studyCopy as copy } from "../study-copy";
import { buttonClassName } from "./Button";
import { Icon } from "./Icon";
import { ProvenanceBlock } from "./Status";
import styles from "./StudyOverview.module.css";

const LOOP_ICONS = [FolderSimple, FileText, Cards] as const;

/** The real first-use experience: available profile actions and explicitly labeled examples. */
export function StudyOverview() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="learning-welcome">
        <div className={styles.heroContent}>
          <span className={styles.eyebrow}>
            <Icon icon={Lightbulb} size={18} />
            {copy.pilot}
          </span>
          <h2 id="learning-welcome" className={styles.heroTitle}>
            {copy.welcome}
          </h2>
          <p className={styles.intro}>{copy.intro}</p>
          <div className={styles.actions}>
            <Link href="/me" className={buttonClassName("primary", "lg")}>
              {copy.profileAction}
              <Icon icon={CaretRight} />
            </Link>
            <a href="#example-note" className={styles.textLink}>
              {copy.exampleAction}
              <Icon icon={CaretRight} size={16} />
            </a>
          </div>
        </div>
        <div className={styles.paperStack} aria-hidden="true">
          <div className={styles.paper}>
            <span className={styles.paperIcon}>
              <Icon icon={FileText} size={28} />
            </span>
            <span className={styles.paperLabel}>{strings.provenance.class}</span>
            <strong>{copy.word}</strong>
            <span>{copy.quote}</span>
            <div className={styles.paperRule} />
            <span className={styles.paperTag}>
              <Icon icon={Cards} size={18} />
              {strings.nav.review}
            </span>
          </div>
        </div>
      </section>
      <LearningLoop />
      <div className={styles.lowerGrid}>
        <section id="example-note" className={styles.example} aria-labelledby="example-heading">
          <span className={styles.eyebrow}>{copy.sampleLabel}</span>
          <h2 id="example-heading">{copy.sampleTitle}</h2>
          <p className={styles.caption}>{copy.sampleCaption}</p>
          <div className={styles.note}>
            <strong className={styles.word}>{copy.word}</strong>
            <ProvenanceBlock kind="class">
              <p className={styles.quote}>{copy.quote}</p>
              <span className={styles.sourceReference}>{copy.source}</span>
            </ProvenanceBlock>
            <ProvenanceBlock kind="ai">
              <p className={styles.explanation}>{copy.explanation}</p>
            </ProvenanceBlock>
          </div>
          <p className={styles.reviewTip}>
            <Icon icon={Cards} />
            {copy.reviewTip}
          </p>
        </section>
        <section className={styles.profile} aria-labelledby="profile-prompt">
          <span className={styles.profileIcon}>
            <Icon icon={UserCircle} size={32} />
          </span>
          <h2 id="profile-prompt">{copy.profileTitle}</h2>
          <p>{copy.profileHelp}</p>
          <Link href="/me" className={styles.textLink}>
            {copy.profileLink}
            <Icon icon={CaretRight} size={18} />
          </Link>
        </section>
      </div>
    </>
  );
}

/** The three-step routine (Figma "Learning step"): what follows once a class is captured. */
export function LearningLoop() {
  return (
    <section aria-labelledby="learning-loop" className={styles.loop}>
      <div className={styles.sectionHead}>
        <h2 id="learning-loop">{copy.loopTitle}</h2>
        <p>{copy.loopHelp}</p>
      </div>
      <ol className={styles.steps}>
        {copy.loop.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <div className={styles.stepTop}>
              <span className={styles.stepIcon}>
                <Icon icon={LOOP_ICONS[index] ?? FolderSimple} size={24} />
              </span>
              <span className={styles.stepNumber}>0{index + 1}</span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
