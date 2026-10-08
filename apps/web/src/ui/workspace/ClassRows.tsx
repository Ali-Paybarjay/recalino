import type { LearningSession } from "@recalino/core/note";
import type { Course, Unit } from "@recalino/core/org";
import Link from "next/link";
import styles from "./ClassRows.module.css";
import { LinkButton } from "./primitives";
import { SessionLearningSummary } from "./SessionLearningSummary";

const classDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function ClassRows({
  sessions,
  courses,
  units,
}: {
  sessions: LearningSession[];
  courses: Course[];
  units: Unit[];
}) {
  const coursesById = new Map(courses.map((course) => [course.id, course]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));

  return (
    <ul className={styles.list}>
      {sessions.map((item) => {
        const course = coursesById.get(item.courseId);
        const unit = item.unitId ? unitsById.get(item.unitId) : undefined;

        return (
          <li key={item.id} className={styles.item}>
            <details className={styles.classDetails}>
              <summary className={styles.row}>
                <time className={styles.date} dateTime={item.classDate}>
                  {classDateFormatter.format(new Date(`${item.classDate}T00:00:00.000Z`))}
                </time>
                <span className={styles.title} dir="auto">
                  {item.displayTitle}
                </span>
                <svg
                  className={styles.chevron}
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="m6 9 6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <div className={styles.content}>
                <div className={styles.information}>
                  <h3 dir="auto">{item.displayTitle}</h3>
                  {course || unit ? (
                    <dl className={styles.metadata}>
                      {course ? (
                        <div>
                          <dt>Course</dt>
                          <dd>
                            <Link href={`/courses/${item.courseId}`}>
                              <bdi>{course.name}</bdi>
                            </Link>
                          </dd>
                        </div>
                      ) : null}
                      {unit ? (
                        <div>
                          <dt>Unit</dt>
                          <dd>
                            <bdi>{unit.name}</bdi>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  <SessionLearningSummary session={item} />
                </div>
                <div className={styles.action}>
                  <LinkButton href={`/classes/${item.id}`}>Go to class</LinkButton>
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
