import type { Course } from "@recalino/core/org";
import Link from "next/link";
import { Panel } from "./primitives";

export function CourseNavigation({
  course,
  courses,
  current,
}: {
  course: Course;
  courses: Course[];
  current: "classes" | "materials";
}) {
  return (
    <Panel>
      <nav className="preview-actions" aria-label="Course views">
        <Link
          className="preview-index-link"
          href={`/courses/${course.id}`}
          aria-current={current === "classes" ? "page" : undefined}
        >
          Classes
        </Link>
        <Link
          className="preview-index-link"
          href={`/courses/${course.id}/materials`}
          aria-current={current === "materials" ? "page" : undefined}
        >
          Course materials
        </Link>
      </nav>
      {courses.length > 1 ? (
        <nav className="preview-actions" aria-label="Switch course">
          {courses.map((item) => (
            <Link
              key={item.id}
              className="preview-index-link"
              dir="auto"
              href={`/courses/${item.id}${current === "materials" ? "/materials" : ""}`}
              aria-current={item.id === course.id ? "true" : undefined}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </Panel>
  );
}
