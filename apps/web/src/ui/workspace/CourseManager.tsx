"use client";
import type { Course, Unit } from "@recalino/core/org";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { InfoTip } from "../components/InfoTip";
import { Sheet } from "../components/Sheet";
import { unitCopy } from "../course-copy";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";

export function CourseManager({
  courses,
  units,
  courseId,
}: {
  courses: Course[];
  units: Unit[];
  courseId?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(courseId ?? courses[0]?.id ?? "");
  const [createdCourses, setCreatedCourses] = useState<Course[]>([]);
  const [courseName, setCourseName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{
    kind: "course" | "unit";
    id: string;
    name: string;
  } | null>(null);
  const courseKey = useRef<{ payload: string; key: string } | null>(null);
  const unitKey = useRef<{ payload: string; key: string } | null>(null);
  const availableCourses = [
    ...courses,
    ...createdCourses.filter((item) => !courses.some((saved) => saved.id === item.id)),
  ];
  const course = availableCourses.find((item) => item.id === selected) ?? availableCourses[0];
  const courseUnits = units.filter((item) => item.courseId === course?.id);

  async function change<T>(
    path: string,
    method: string,
    body?: unknown,
    key?: string,
  ): Promise<T | null> {
    if (busy) return null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workspaceRequest<T>(path, method, body, key);
      router.refresh();
      setNotice("Your changes are saved.");
      return result;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The change could not be saved. Try again.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function addCourse() {
    const body = { name: courseName.trim() };
    if (!body.name) {
      setError("Enter a course name.");
      return;
    }
    const result = await change<Course>("/api/courses", "POST", body, requestKey(courseKey, body));
    if (result) {
      setCreatedCourses((items) => [...items.filter((item) => item.id !== result.id), result]);
      setCourseName("");
      setSelected(result.id);
      courseKey.current = null;
    }
  }
  async function addUnit() {
    if (!course) return;
    const body = { name: unitName.trim() };
    const result = await change<Unit>(
      `/api/courses/${course.id}/units`,
      "POST",
      body,
      requestKey(unitKey, { ...body, courseId: course.id }),
    );
    if (result) {
      setUnitName("");
      unitKey.current = null;
    }
  }
  async function remove() {
    if (!confirm) return;
    const result = await change<{ deleted: boolean }>(
      `/api/${confirm.kind === "course" ? "courses" : "units"}/${confirm.id}`,
      "DELETE",
    );
    if (result) {
      if (confirm.kind === "course") {
        setSelected("");
        setCreatedCourses((items) => items.filter((item) => item.id !== confirm.id));
      }
      setConfirm(null);
    }
  }

  return (
    <div className="preview-stack">
      {error ? <Status tone="error">{error}</Status> : null}
      {notice ? <Status tone="success">{notice}</Status> : null}
      <div className="preview-grid">
        <Panel title="Create a course">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addCourse();
            }}
          >
            <Field label="New course name">
              <input
                dir="auto"
                required
                maxLength={160}
                disabled={busy}
                value={courseName}
                onChange={(event) => setCourseName(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create course"}
            </Button>
          </form>
        </Panel>
        <Panel title="Course settings">
          {course ? (
            <>
              <Field label="Selected course">
                <select
                  value={course.id}
                  disabled={busy}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setError("");
                    setNotice("");
                  }}
                >
                  {availableCourses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.isDefault ? " · Default" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <form
                key={`${course.id}-${course.name}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = new FormData(event.currentTarget);
                  void change(`/api/courses/${course.id}`, "PATCH", {
                    name: String(values.get("name")).trim(),
                  });
                }}
              >
                <Field label="Course name">
                  <input
                    dir="auto"
                    name="name"
                    required
                    maxLength={160}
                    defaultValue={course.name}
                    disabled={busy}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  Rename course
                </Button>
              </form>
              <Actions>
                <LinkButton secondary href={`/courses/${course.id}`}>
                  View course
                </LinkButton>
                <LinkButton secondary href={`/courses/${course.id}/materials`}>
                  Course materials
                </LinkButton>
                <LinkButton secondary href={`/classes/new?courseId=${course.id}`}>
                  New class in this course
                </LinkButton>
                {!course.isDefault ? (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "course", id: course.id, name: course.name })}
                  >
                    Delete empty course
                  </Button>
                ) : null}
              </Actions>
              {course.isDefault ? (
                <p className="preview-muted">
                  Your default course can be renamed. It always remains available for new classes.
                </p>
              ) : (
                <p className="preview-muted">
                  Move or delete its classes before deleting this course.
                </p>
              )}
            </>
          ) : (
            <p>
              Your first course is created automatically when you create a class. You can also
              create one here.
            </p>
          )}
        </Panel>
      </div>
      {course ? (
        <Panel
          title="Optional units"
          info={
            <InfoTip label={unitCopy.helpLabel}>
              {unitCopy.help.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </InfoTip>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addUnit();
            }}
          >
            <Field label="New unit name">
              <input
                required
                maxLength={160}
                dir="auto"
                placeholder={unitCopy.namePlaceholder}
                value={unitName}
                disabled={busy}
                onChange={(event) => setUnitName(event.target.value)}
              />
            </Field>
            <Button disabled={busy} type="submit">
              Create unit
            </Button>
          </form>
          {courseUnits.length ? (
            <ul className="preview-list">
              {courseUnits.map((item) => (
                <li key={`${item.id}-${item.name}-${item.position}`}>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void change(`/api/units/${item.id}`, "PATCH", {
                        name: String(data.get("name")).trim(),
                        position: Number(data.get("position")),
                      });
                    }}
                  >
                    <h3 dir="auto">{item.name}</h3>
                    <Field label={`Unit name: ${item.name}`}>
                      <input
                        dir="auto"
                        name="name"
                        maxLength={160}
                        required
                        disabled={busy}
                        defaultValue={item.name}
                      />
                    </Field>
                    <Field label={`Order: ${item.name}`}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        required
                        name="position"
                        disabled={busy}
                        defaultValue={item.position}
                      />
                    </Field>
                    <Actions>
                      <Button type="submit" disabled={busy}>
                        Save unit
                      </Button>
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "unit", id: item.id, name: item.name })}
                      >
                        Delete unit
                      </Button>
                    </Actions>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="preview-muted">No units yet.</p>
          )}
        </Panel>
      ) : null}
      <Sheet
        open={confirm !== null}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title={`Delete this ${confirm?.kind ?? "group"}?`}
      >
        <p>
          <bdi>{confirm?.name}</bdi> can be deleted only when it contains no classes. Empty units in
          a deleted course are removed with it.
        </p>
        <Actions>
          <Button disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : `Delete ${confirm?.kind ?? "group"}`}
          </Button>
          <Button secondary disabled={busy} onClick={() => setConfirm(null)}>
            Keep it
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
