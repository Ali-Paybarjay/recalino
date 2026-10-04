import type { ClassSession, Course, Unit } from "@recalino/core/org";
import { LinkButton } from "./primitives";

export function ClassRows({
  sessions,
  courses,
  units,
}: {
  sessions: ClassSession[];
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
                <bdi>{courses.find((course) => course.id === item.courseId)?.name}</bdi>
                {item.unitId ? (
                  <>
                    {" "}
                    · <bdi>{units.find((unit) => unit.id === item.unitId)?.name}</bdi>
                  </>
                ) : null}{" "}
                · {item.classDate}
              </p>
            </div>
            <LinkButton secondary href={`/classes/${item.id}`}>
              Open class
            </LinkButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
