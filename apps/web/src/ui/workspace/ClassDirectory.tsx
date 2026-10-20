"use client";

import type { LearningSession } from "@recalino/core/note";
import type { Course, Unit } from "@recalino/core/org";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "../components/Icon";
import { ChalkboardSimple } from "../icons";
import { workspaceRequest } from "./api";
import styles from "./ClassDirectory.module.css";
import { ClassRows } from "./ClassRows";
import { Actions, Button, Field, LinkButton } from "./primitives";

const CLASS_BATCH_SIZE = 20;

type SessionPage = { items: LearningSession[]; total: number };

export function ClassDirectory({
  courses,
  units,
  selectedCourseId,
  allCourses = false,
  unitId,
  initialSessions,
}: {
  courses: Course[];
  units: Unit[];
  selectedCourseId: string | null;
  allCourses?: boolean;
  unitId?: string;
  initialSessions: SessionPage;
}) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const [sessions, setSessions] = useState(initialSessions.items);
  const [total, setTotal] = useState(initialSessions.total);
  const [offset, setOffset] = useState(initialSessions.items.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const courseUnits = units.filter((unit) => unit.courseId === selectedCourseId);
  const hasSelection = Boolean(selectedCourseId || allCourses);
  const hasMore = offset < total;
  const newClassHref = selectedCourseId
    ? `/sessions/new?courseId=${selectedCourseId}`
    : "/sessions/new";

  useEffect(() => () => request.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (pending.current || !hasMore || switching) return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: String(CLASS_BATCH_SIZE),
        offset: String(offset),
        order: "newest",
        ...(selectedCourseId ? { courseId: selectedCourseId } : {}),
        ...(unitId ? { unitId } : {}),
      });
      const page = await workspaceRequest<SessionPage>(
        `/api/classes?${query}`,
        "GET",
        undefined,
        undefined,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setSessions((previous) => {
        const existing = new Set(previous.map((session) => session.id));
        return [...previous, ...page.items.filter((session) => !existing.has(session.id))];
      });
      setTotal(page.total);
      setOffset(page.items.length ? offset + page.items.length : page.total);
    } catch {
      if (!controller.signal.aborted) setError("More sessions could not be loaded. Try again.");
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [hasMore, switching, offset, selectedCourseId, unitId]);

  useEffect(() => {
    if (!hasMore || error || switching || !sentinel.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, error, switching, loadMore]);

  function switchCourse(value: string) {
    request.current?.abort();
    startTransition(() => {
      router.push(
        value === "__all__"
          ? "/sessions?scope=all"
          : value
            ? `/sessions?courseId=${value}`
            : "/sessions",
        { scroll: false },
      );
    });
  }

  return (
    <div className={styles.directory} aria-busy={switching || undefined}>
      <section className={styles.courseBar} aria-label="Choose your course">
        <div className={styles.courseIcon}>
          <Icon icon={ChalkboardSimple} size={28} />
        </div>
        <div className={styles.courseControl}>
          {courses.length > 1 ? (
            <Field label="Course">
              <select
                className="input"
                value={allCourses ? "__all__" : (selectedCourseId ?? "")}
                disabled={switching}
                onChange={(event) => switchCourse(event.target.value)}
              >
                <option value="" disabled>
                  Choose a course
                </option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
                <option value="__all__">All sessions</option>
              </select>
            </Field>
          ) : (
            <div>
              <p className={styles.courseLabel}>Course</p>
              <h2 className={styles.courseName} dir="auto">
                {selectedCourse?.name ?? "Your courses"}
              </h2>
            </div>
          )}
        </div>
        {selectedCourseId && courseUnits.length ? (
          <div className={styles.unitControl}>
            <Field label="Unit">
              <select
                className="input"
                value={unitId ?? ""}
                disabled={switching}
                onChange={(event) =>
                  startTransition(() =>
                    router.push(
                      `/sessions?${new URLSearchParams({ courseId: selectedCourseId, ...(event.target.value ? { unitId: event.target.value } : {}) })}`,
                      { scroll: false },
                    ),
                  )
                }
              >
                <option value="">All units</option>
                {courseUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        {switching ? <p role="status">Loading sessions…</p> : null}
      </section>

      {hasSelection ? (
        <section className={styles.classes} aria-label="Session list">
          <div className={styles.listHeading}>
            <h2>{allCourses ? "All sessions" : "Sessions"}</h2>
            <p className="workspace-muted">Most recent first · Select a session to see more</p>
          </div>
          {sessions.length ? (
            <ClassRows sessions={sessions} courses={courses} units={units} />
          ) : (
            <div className={styles.empty}>
              <h3>{unitId ? "No sessions in this unit yet" : "Your first session starts here"}</h3>
              <p>Add a session, then keep its notes and flashcards together.</p>
              <LinkButton href={newClassHref}>Create a session</LinkButton>
            </div>
          )}
          {sessions.length ? (
            <div className={styles.listFooter}>
              <p className="workspace-muted" role="status" aria-live="polite">
                {sessions.length} of {total} {total === 1 ? "session" : "sessions"}
              </p>
              {error ? <p role="alert">{error}</p> : null}
              {hasMore ? (
                <div ref={sentinel}>
                  <Button secondary disabled={loading || switching} onClick={() => void loadMore()}>
                    {loading ? "Loading sessions…" : error ? "Try again" : "Load more sessions"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <div className={styles.empty}>
          <h2>
            {courses.length ? "Choose a course to see its sessions" : "Add your first course"}
          </h2>
          <p>
            {courses.length
              ? "Your sessions will appear here, ordered by date."
              : "Keep each subject and its sessions together in a course."}
          </p>
          {!courses.length ? (
            <LinkButton href="/sessions/organize">Create a course</LinkButton>
          ) : null}
        </div>
      )}

      <footer className={styles.tools}>
        {hasSelection ? (
          <Link className={styles.newClass} href={newClassHref}>
            + New session
          </Link>
        ) : null}
        <details className={styles.manage}>
          <summary>Course tools</summary>
          <Actions>
            <LinkButton
              secondary
              href={
                selectedCourseId
                  ? `/sessions/organize?courseId=${selectedCourseId}`
                  : "/sessions/organize"
              }
            >
              Manage courses and units
            </LinkButton>
            {selectedCourseId ? (
              <LinkButton secondary href={`/courses/${selectedCourseId}/materials`}>
                Course materials
              </LinkButton>
            ) : null}
            <LinkButton secondary href="/courses">
              Manage courses
            </LinkButton>
          </Actions>
        </details>
      </footer>
    </div>
  );
}
