"use client";
import type { ClassSession, Course, Unit } from "@recalino/core/org";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DateInput } from "../components/DateInput";
import { Sheet } from "../components/Sheet";
import { courseCopy } from "../course-copy";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";

const CREATE_NEW_COURSE = "__create_new_course__";

export function ClassForm({
  courses,
  units,
  today,
  initial,
  courseId,
}: {
  courses: Course[];
  units: Unit[];
  today: string;
  initial?: ClassSession;
  courseId?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.classDate ?? today);
  const [course, setCourse] = useState(
    initial?.courseId ?? courseId ?? courses.find((item) => item.isDefault)?.id ?? "",
  );
  const [unit, setUnit] = useState(initial?.unitId ?? "");
  const [createdCourses, setCreatedCourses] = useState<Course[]>([]);
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [courseNotice, setCourseNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const idempotency = useRef<{ payload: string; key: string } | null>(null);
  const courseIdempotency = useRef<{ payload: string; key: string } | null>(null);
  const availableCourses = [
    ...courses,
    ...createdCourses.filter((item) => !courses.some((saved) => saved.id === item.id)),
  ];
  const hasDefault = availableCourses.some((item) => item.isDefault);
  const destination = initial ? `/sessions/${initial.id}` : "/sessions";

  async function save() {
    if (busy || creatingCourse) return;
    const body = {
      title: title.trim() || null,
      classDate: date,
      ...(course ? { courseId: course } : {}),
      unitId: unit || null,
    };
    setBusy(true);
    setError("");
    try {
      const saved = await workspaceRequest<ClassSession>(
        initial ? `/api/classes/${initial.id}` : "/api/classes",
        initial ? "PATCH" : "POST",
        body,
        initial ? undefined : requestKey(idempotency, body),
      );
      router.push(`/sessions/${saved.id}`);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Your session could not be saved. Try again.",
      );
      setBusy(false);
    }
  }

  async function addCourse() {
    if (busy || creatingCourse) return;
    const body = { name: courseName.trim() };
    if (!body.name) {
      setCourseError("Enter a course name.");
      return;
    }
    setCreatingCourse(true);
    setCourseError("");
    try {
      const saved = await workspaceRequest<Course>(
        "/api/courses",
        "POST",
        body,
        requestKey(courseIdempotency, body),
      );
      setCreatedCourses((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      setCourse(saved.id);
      setUnit("");
      setCourseName("");
      setCreateCourseOpen(false);
      setCourseNotice("Course created and selected.");
      courseIdempotency.current = null;
    } catch (failure) {
      setCourseError(
        failure instanceof Error ? failure.message : "The course could not be created. Try again.",
      );
    } finally {
      setCreatingCourse(false);
    }
  }

  async function remove() {
    if (!initial || busy) return;
    setBusy(true);
    setError("");
    try {
      await workspaceRequest(
        `/api/classes/${initial.id}`,
        "DELETE",
        undefined,
        requestKey(idempotency, { delete: initial.id }),
      );
      router.push("/sessions");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The session could not be deleted. Try again.",
      );
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="preview-reader">
      <Panel title={initial ? "Session details" : undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Session date" hint="Day / Month / Year">
            <DateInput required value={date} onChange={setDate} disabled={busy} />
          </Field>
          <Field label="Course" hint={courseCopy.courseHelp}>
            <select
              value={course}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value === CREATE_NEW_COURSE) {
                  setCourseError("");
                  setCourseNotice("");
                  setCreateCourseOpen(true);
                  return;
                }
                setCourse(event.target.value);
                setUnit("");
                setCourseNotice("");
              }}
            >
              {!hasDefault && !initial ? <option value="">Default course</option> : null}
              {availableCourses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.isDefault ? " · Default" : ""}
                </option>
              ))}
              <option value={CREATE_NEW_COURSE}>Create New Course</option>
            </select>
          </Field>
          {courseNotice ? <Status tone="success">{courseNotice}</Status> : null}
          {course && units.some((item) => item.courseId === course) ? (
            <Field label="Unit (optional)">
              <select
                disabled={busy}
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                <option value="">No unit</option>
                {units
                  .filter((item) => item.courseId === course)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          {/* D51: new sessions are named from their material; renaming lives in Session options. */}
          {initial ? (
            <Field
              label="Session name (optional)"
              hint="Leave it empty to name the session from its learning material. Until the material is ready, its date is used."
            >
              <input
                autoComplete="off"
                dir="auto"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Automatic title from learning material"
                disabled={busy}
              />
            </Field>
          ) : null}
          {initial && title.trim() ? (
            <Actions>
              <Button secondary disabled={busy} onClick={() => setTitle("")}>
                Use automatic title
              </Button>
            </Actions>
          ) : null}
          {initial && !title.trim() ? (
            <p className="preview-muted">
              Save changes to use the title from your learning material.
            </p>
          ) : null}
          {error ? <Status tone="error">{error}</Status> : null}
          <Actions>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : initial ? "Save changes" : "Create session"}
            </Button>
            <LinkButton href={destination} secondary>
              Cancel
            </LinkButton>
          </Actions>
        </form>
        {initial ? (
          <Actions>
            <Button secondary disabled={busy} onClick={() => setConfirm(true)}>
              Delete session
            </Button>
          </Actions>
        ) : null}
      </Panel>
      <Sheet
        open={createCourseOpen}
        onClose={() => {
          if (!creatingCourse) setCreateCourseOpen(false);
        }}
        title="Create a course"
      >
        <p>{courseCopy.goalHelp}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addCourse();
          }}
        >
          <Field label="New course name" hint="For example, ESOL B1 or Business English.">
            <input
              autoComplete="off"
              dir="auto"
              required
              maxLength={160}
              value={courseName}
              disabled={creatingCourse}
              onChange={(event) => setCourseName(event.target.value)}
            />
          </Field>
          {courseError ? <Status tone="error">{courseError}</Status> : null}
          <Actions>
            <Button type="submit" disabled={creatingCourse}>
              {creatingCourse ? "Creating…" : "Create course"}
            </Button>
            <Button secondary disabled={creatingCourse} onClick={() => setCreateCourseOpen(false)}>
              Cancel
            </Button>
          </Actions>
        </form>
      </Sheet>
      <Sheet
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        title="Delete this session?"
      >
        <p>
          The session will disappear immediately. Its server files, notes and cards used only by
          this session, including their review history, are queued for removal. Items linked to
          other sessions are checked before removal.
        </p>
        <p>
          Recordings saved on this device and files you downloaded are separate copies. Session
          deletion does not remove them.
        </p>
        <Actions>
          <Button danger disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete session"}
          </Button>
          <Button secondary disabled={busy} onClick={() => setConfirm(false)}>
            Keep it
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
