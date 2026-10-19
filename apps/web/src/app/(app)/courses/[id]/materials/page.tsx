import { listCourseMaterials } from "@recalino/core/note";
import { listCourses } from "@recalino/core/org";
import Link from "next/link";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor, workspaceCourse } from "../../../../../server/workspace";
import { Icon } from "../../../../../ui/components/Icon";
import { CaretRight, CheckCircle, FileText } from "../../../../../ui/icons";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { CourseNavigation } from "../../../../../ui/workspace/CourseNavigation";
import { Actions, LinkButton, Panel } from "../../../../../ui/workspace/primitives";
import { LearnerShell } from "../../../LearnerShell";
import styles from "./CourseMaterials.module.css";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;

export default async function CourseMaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const learner = await requireLearner(`/courses/${id}/materials`);
  const course = await workspaceCourse(learner, id);
  const db = getDatabase(),
    ctx = workspaceActor(learner);
  const [courses, query] = await Promise.all([listCourses(db, ctx), searchParams]);
  const page = /^\d{1,6}$/.test(query.page ?? "") ? Math.max(1, Number(query.page)) : 1;
  const materials = await listCourseMaterials(db, ctx, id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pageHref = (number: number) => `/courses/${id}/materials?page=${number}`;

  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Course materials" subtitle={course.name} />}
    >
      <div className="preview-stack">
        <Link className="preview-back" href="/courses">
          ← Manage courses
        </Link>
        <CourseNavigation course={course} courses={courses} current="materials" />
        <Panel title="Learn through this course">
          <p>
            Choose a session to read its notes. Your sessions stay in date order, with their own
            flashcards and sources.
          </p>
          {materials.items.length ? (
            <nav className="preview-actions" aria-label="Jump to a session">
              {materials.items.map(({ session }) => (
                <a key={session.id} className="preview-index-link" href={`#class-${session.id}`}>
                  <span>
                    <time dateTime={session.classDate}>{session.classDate}</time>
                    {session.titleSource !== "date" ? (
                      <>
                        {" "}
                        · <bdi>{session.displayTitle}</bdi>
                      </>
                    ) : null}
                  </span>
                </a>
              ))}
            </nav>
          ) : null}
          <Actions>
            <LinkButton secondary href={`/sessions/new?courseId=${id}`}>
              New session in this course
            </LinkButton>
          </Actions>
        </Panel>
        {materials.items.map(({ session, notebook }) => (
          <section
            key={session.id}
            id={`class-${session.id}`}
            aria-labelledby={`title-${session.id}`}
            className={styles.sessionCard}
          >
            <div className={styles.sessionHeading}>
              <span className={styles.noteIcon}>
                <Icon icon={FileText} size={26} />
              </span>
              <div className={styles.sessionTitle}>
                <p className={styles.date}>
                  Session · <time dateTime={session.classDate}>{session.classDate}</time>
                </p>
                <h2 id={`title-${session.id}`} dir="auto">
                  {session.displayTitle}
                </h2>
              </div>
              <span className={notebook ? styles.readyBadge : styles.pendingBadge}>
                {notebook ? <Icon icon={CheckCircle} size={16} /> : null}
                {notebook ? "Notes ready" : "No notes yet"}
              </span>
            </div>
            {session.topics.length ? (
              <ul className={styles.topics} aria-label="Session topics">
                {session.topics.slice(0, 3).map((topic) => (
                  <li key={topic}>
                    <bdi>{topic}</bdi>
                  </li>
                ))}
                {session.topics.length > 3 ? (
                  <li className={styles.moreTopics}>
                    <Link href={`/sessions/${session.id}#topics`}>
                      See all {session.topics.length} topics
                    </Link>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {!notebook ? (
              <p className={styles.emptyNotes}>
                Add session material to create notes for this session automatically.
              </p>
            ) : null}
            <div className={styles.sessionFooter}>
              <Link
                href={
                  notebook ? `/sessions/${session.id}/notes` : `/sessions/${session.id}/sources`
                }
                prefetch={false}
                className={styles.readLink}
              >
                {notebook ? "Read session notes" : "Add session material"}
                <Icon icon={CaretRight} size={18} />
              </Link>
              <div className={styles.sessionLinks}>
                <Link href={`/sessions/${session.id}`} prefetch={false}>
                  Open session
                </Link>
                {!notebook ? (
                  <Link href={`/sessions/${session.id}/notes`} prefetch={false}>
                    Session notes
                  </Link>
                ) : null}
                <Link href={`/sessions/${session.id}/cards`} prefetch={false}>
                  Flashcards
                </Link>
                <Link href={`/sessions/${session.id}/sources`} prefetch={false}>
                  Session material
                </Link>
              </div>
            </div>
          </section>
        ))}
        {!materials.items.length ? (
          <Panel title={materials.total ? "No sessions on this page" : "Your course starts here"}>
            <p>
              {materials.total
                ? "Choose an earlier page to keep reading."
                : "Create a dated session and add its material. Its notes will appear here automatically in course order."}
            </p>
            <LinkButton
              secondary
              href={materials.total ? pageHref(1) : `/sessions/new?courseId=${id}`}
            >
              {materials.total ? "First page" : "Create a session in this course"}
            </LinkButton>
          </Panel>
        ) : null}
        {materials.total > PAGE_SIZE ? (
          <Panel>
            <nav className="preview-actions" aria-label="Course material pages">
              {page > 1 ? (
                <LinkButton secondary href={pageHref(page - 1)}>
                  Previous sessions
                </LinkButton>
              ) : null}
              <p className="preview-muted">
                Page {page} · {materials.total} sessions · Oldest first
              </p>
              {page * PAGE_SIZE < materials.total ? (
                <LinkButton secondary href={pageHref(page + 1)}>
                  Next sessions
                </LinkButton>
              ) : null}
            </nav>
          </Panel>
        ) : null}
      </div>
    </LearnerShell>
  );
}
