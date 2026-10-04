"use client";
import type { ClassSession, Course, Unit } from "@recalino/core/org";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";

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
  const [course, setCourse] = useState(initial?.courseId ?? courseId ?? "");
  const [unit, setUnit] = useState(initial?.unitId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const idempotency = useRef<{ payload: string; key: string } | null>(null);
  const destination = initial ? `/classes/${initial.id}` : "/classes";

  async function save() {
    if (busy) return;
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
      router.push(`/classes/${saved.id}`);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Your class could not be saved. Try again.",
      );
      setBusy(false);
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
      router.push("/classes");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The class could not be deleted. Try again.",
      );
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="preview-reader">
      <Panel title={initial ? "Class details" : undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field
            label="Class name (optional)"
            hint="Leave it empty to use the class date as its name."
          >
            <input
              autoComplete="off"
              dir="auto"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="For example, Present perfect"
              disabled={busy}
            />
          </Field>
          <Field label="Class date">
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Field
            label="Course"
            hint={!course ? "This class will go in your default course." : undefined}
          >
            <select
              value={course}
              disabled={busy}
              onChange={(event) => {
                setCourse(event.target.value);
                setUnit("");
              }}
            >
              {!initial ? <option value="">Default course</option> : null}
              {courses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
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
          {error ? <Status tone="error">{error}</Status> : null}
          <Actions>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : initial ? "Save changes" : "Create class"}
            </Button>
            <LinkButton href={destination} secondary>
              Cancel
            </LinkButton>
          </Actions>
        </form>
        {initial ? (
          <Actions>
            <Button secondary disabled={busy} onClick={() => setConfirm(true)}>
              Delete class
            </Button>
          </Actions>
        ) : null}
      </Panel>
      <Sheet
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        title="Delete this class?"
      >
        <p>
          The class will disappear immediately. Its server files, notes and cards used only by this
          class, including their review history, are queued for removal. Items linked to other
          classes are checked before removal.
        </p>
        <p>
          Recordings saved on this device and files you downloaded are separate copies. Class
          deletion does not remove them.
        </p>
        <Actions>
          <Button disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete class"}
          </Button>
          <Button secondary disabled={busy} onClick={() => setConfirm(false)}>
            Keep it
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
