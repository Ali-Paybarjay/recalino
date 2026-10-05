import type { LearningSession } from "@recalino/core/note";
import type { Course, Unit } from "@recalino/core/org";
import Link from "next/link";
import { Actions, LinkButton } from "./primitives";
import { SessionLearningSummary } from "./SessionLearningSummary";

export function ClassRows({
  sessions,
  courses,
  units,
}: {
  sessions: LearningSession[];
  courses: Course[];
  units: Unit[];
}) {
  return (
    <ul className="preview-list">
      {sessions.map((item) => (
        <li key={item.id}>
          <div className="preview-row">
            <div>
              <h3 dir="auto">{item.displayTitle}</h3>
              <p className="preview-muted">
                <Link href={`/courses/${item.courseId}`}>
                  <bdi>{courses.find((course) => course.id === item.courseId)?.name}</bdi>
                </Link>
                {item.unitId ? (
                  <>
                    {" "}
                    · <bdi>{units.find((unit) => unit.id === item.unitId)?.name}</bdi>
                  </>
                ) : null}
              </p>
              <SessionLearningSummary session={item} />
            </div>
            <Actions>
              <LinkButton secondary href={`/classes/${item.id}`}>
                Open class
              </LinkButton>
              <LinkButton secondary href={`/classes/${item.id}/notes`}>
                Class notes
              </LinkButton>
            </Actions>
          </div>
        </li>
      ))}
    </ul>
  );
}
