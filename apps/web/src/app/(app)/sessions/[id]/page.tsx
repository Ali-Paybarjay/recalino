import Link from "next/link";
import { requireLearner } from "../../../../server/auth/learner";
import { workspaceGroups, workspaceSession } from "../../../../server/workspace";
import { Icon } from "../../../../ui/components/Icon";
import { Cards, CaretLeft, CaretRight, FileText } from "../../../../ui/icons";
import { RecordLauncher } from "../../../../ui/recording/RecordingProvider";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { AutomaticLearningNotice } from "../../../../ui/workspace/AutomaticLearningView";
import { Actions, LinkButton } from "../../../../ui/workspace/primitives";
import { LearnerShell } from "../../LearnerShell";
import styles from "./ClassOverview.module.css";
export const dynamic = "force-dynamic";
export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}`);
  const session = await workspaceSession(learner, id);
  const groups = await workspaceGroups(learner);
  const course = groups.courses.find((item) => item.id === session.courseId);
  const unit = groups.units.find((item) => item.id === session.unitId);
  const classDate = session.classDate.split("-").reverse().join("/");
  const subtitle = [course?.name, unit?.name, classDate].filter(Boolean).join(" · ");
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title={session.displayTitle} subtitle={subtitle} />}
    >
      <div className={styles.overview}>
        <Link
          href={`/sessions?courseId=${encodeURIComponent(session.courseId)}`}
          className={styles.back}
        >
          <Icon icon={CaretLeft} size={18} />
          Back to course
        </Link>
        <section className={styles.learning} aria-label="Study this session">
          <Link
            href={`/sessions/${id}/notes`}
            prefetch={false}
            className={`${styles.destination} ${styles.notes}`}
            aria-labelledby="class-notes-heading"
            aria-describedby="class-notes-description"
          >
            <span className={styles.destinationIcon}>
              <Icon icon={FileText} size={28} />
            </span>
            <div className={styles.destinationBody}>
              <h2 id="class-notes-heading">Session notes</h2>
              <p id="class-notes-description">Read the lesson and revisit what you learned.</p>
            </div>
            <span className={styles.destinationAction}>
              Read notes <Icon icon={CaretRight} size={18} />
            </span>
          </Link>
          <Link
            href={`/sessions/${id}/cards`}
            prefetch={false}
            className={`${styles.destination} ${styles.cards}`}
            aria-labelledby="class-flashcards-heading"
            aria-describedby="class-flashcards-description"
          >
            <span className={styles.destinationIcon}>
              <Icon icon={Cards} size={28} />
            </span>
            <div className={styles.destinationBody}>
              <h2 id="class-flashcards-heading">Flashcards</h2>
              <p id="class-flashcards-description">Practise this lesson, one card at a time.</p>
            </div>
            <span className={styles.destinationAction}>
              Practise cards <Icon icon={CaretRight} size={18} />
            </span>
          </Link>
        </section>
        <AutomaticLearningNotice sessionId={id} />
        <section id="topics" aria-labelledby="class-topics-heading" className={styles.topics}>
          <h2 id="class-topics-heading">Topics covered</h2>
          {session.titleSource !== "date" ? (
            <p className={styles.titleSource}>
              {session.titleSource === "manual" ? "Custom title" : "Title from material"}
            </p>
          ) : null}
          {session.topics.length ? (
            <ul className={styles.topicList}>
              {session.topics.map((topic) => (
                <li key={topic} dir="auto">
                  {topic}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {session.titleSource === "date"
                ? "Add session material below. Your lesson title, notes and flashcards will appear automatically."
                : "Open session notes to explore this lesson. Topics will appear here when included in the learning material."}
            </p>
          )}
        </section>
        <section aria-labelledby="class-material-heading" className={styles.material}>
          <div>
            <h2 id="class-material-heading">Session material</h2>
            <p>Add a recording, handout or photo to update your notes and flashcards.</p>
          </div>
          <Actions>
            <RecordLauncher sessionId={id} />
            <LinkButton secondary href={`/sessions/${id}/sources`}>
              Add or view material
            </LinkButton>
          </Actions>
        </section>
        <details className={styles.tools}>
          <summary>
            More session tools
            <Icon icon={CaretRight} size={20} className={styles.toolsCaret} />
          </summary>
          <div className={styles.toolsContent}>
            <Actions>
              <LinkButton secondary href={`/sessions/${id}/estimate`}>
                View progress
              </LinkButton>
              <LinkButton secondary href={`/sessions/${id}/export`}>
                Download notes and cards
              </LinkButton>
              <LinkButton secondary href={`/sessions/${id}/options`}>
                Session options
              </LinkButton>
              <LinkButton secondary href={`/courses/${session.courseId}/materials`}>
                Course materials
              </LinkButton>
            </Actions>
          </div>
        </details>
      </div>
    </LearnerShell>
  );
}
