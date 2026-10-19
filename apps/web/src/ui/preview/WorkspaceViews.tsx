"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DateInput } from "../components/DateInput";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { courseCopy } from "../course-copy";
import { Cards, ChalkboardSimple, FileText, Microphone } from "../icons";
import directoryStyles from "../workspace/ClassDirectory.module.css";
import classStyles from "../workspace/ClassRows.module.css";
import { Actions, Button, Field, Panel, Status } from "../workspace/primitives";
import learningStyles from "./LearningViews.module.css";
import { usePreview } from "./PreviewContext";
import { LinkButton, PageHeader } from "./preview-links";
import { sampleClassSummary, sampleCustomTitle } from "./sample-material";

const CREATE_NEW_COURSE = "";
const ALL_COURSES = "__all__";
const CLASS_BATCH_SIZE = 20;
const classDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function displayClassDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : classDateFormatter.format(date);
}

export function WorkspaceViews({ screen }: { screen: string }) {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const lesson = state.classes[0];
  const [name, setName] = useState(
    screen === "organize" && lesson ? (sampleCustomTitle(lesson) ?? "") : "",
  );
  const [course, setCourse] = useState(lesson?.course ?? "My Courses");
  const [unit, setUnit] = useState(screen === "organize" ? (lesson?.unit ?? "") : "");
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [classDate, setClassDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [unitName, setUnitName] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const confirmLabel = confirm === "class" ? "session" : confirm;
  const [visibleCount, setVisibleCount] = useState(CLASS_BATCH_SIZE);
  const [materialsPage, setMaterialsPage] = useState(0);
  const initializedCourseScreen = useRef<string | null>(null);
  const classSentinel = useRef<HTMLDivElement>(null);
  const courseTools = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (screen !== "organize") return;
    if (!lesson?.id) {
      setName("");
      setCourse("My Courses");
      setUnit("");
      return;
    }
    setName(
      sampleCustomTitle({
        title: lesson.title,
        date: lesson.date,
        customTitle: lesson.customTitle,
      }) ?? "",
    );
    setCourse(lesson?.course ?? "My Courses");
    setUnit(lesson?.unit ?? "");
  }, [
    screen,
    lesson?.id,
    lesson?.title,
    lesson?.date,
    lesson?.customTitle,
    lesson?.course,
    lesson?.unit,
  ]);
  useEffect(() => {
    if (!["new-class", "classes", "course"].includes(screen)) return;
    const requested = new URLSearchParams(window.location.search).get("course");
    const available = state.courses.find((item) => item.name === requested);
    const current = state.courses.find((item) => item.name === lesson?.course);
    const fallback = state.courses.find((item) => item.name === "My Courses") ?? state.courses[0];
    const initialize = initializedCourseScreen.current !== screen;
    if (screen !== "new-class") {
      setCourseFilter((selected) => {
        if (
          !initialize &&
          (selected === ALL_COURSES || state.courses.some((item) => item.name === selected))
        )
          return selected;
        return (
          available?.name ??
          (requested === ALL_COURSES
            ? ALL_COURSES
            : state.courses.length === 1
              ? (state.courses[0]?.name ?? null)
              : null)
        );
      });
    }
    setCourse((selected) =>
      screen === "new-class" && !initialize && state.courses.some((item) => item.name === selected)
        ? selected
        : (available?.name ?? current?.name ?? fallback?.name ?? "My Courses"),
    );
    initializedCourseScreen.current = screen;
  }, [screen, lesson?.course, state.courses]);
  const selectedCourse =
    state.courses.length === 1
      ? state.courses[0]
      : state.courses.find((item) => item.name === courseFilter);
  const allCourses = courseFilter === ALL_COURSES;
  const hasSelection = Boolean(selectedCourse || allCourses);
  useEffect(() => {
    if (
      screen === "course" &&
      selectedCourse?.id &&
      window.location.hash === "#course-materials" &&
      courseTools.current
    )
      courseTools.current.open = true;
  }, [screen, selectedCourse?.id]);
  const newClassTo = selectedCourse
    ? `new-class?course=${encodeURIComponent(selectedCourse.name)}`
    : "new-class";
  function summaryFor(item: (typeof state.classes)[number]) {
    const content = item.id === lesson?.id ? state : state.classWorkspaces[item.id];
    return sampleClassSummary(item, content?.materialMetadata);
  }
  const titleStatus = (source: "manual" | "material" | "date") =>
    source === "manual"
      ? "Custom title"
      : source === "material"
        ? "Title from material"
        : "Waiting for material";
  const newestFirst = (
    left: (typeof state.classes)[number],
    right: (typeof state.classes)[number],
  ) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id);
  const recentClasses = [...state.classes].sort(newestFirst);
  const visible = recentClasses.filter(
    (item) => allCourses || item.course === selectedCourse?.name,
  );
  const courseSessions = state.classes
    .filter((item) => item.course === selectedCourse?.name)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  useEffect(() => {
    if (
      !["classes", "course"].includes(screen) ||
      visibleCount >= visible.length ||
      !classSentinel.current ||
      !window.IntersectionObserver
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setVisibleCount((count) => Math.min(count + CLASS_BATCH_SIZE, visible.length));
      },
      { rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(classSentinel.current);
    return () => observer.disconnect();
  }, [screen, visibleCount, visible.length]);
  const notesAvailable = state.noteText.trim().length > 0;
  const due = state.cards.filter((card) => card.status === "active").length;
  const countClasses = (selectedCourse: string) => {
    const count = state.classes.filter((item) => item.course === selectedCourse).length;
    return `${count} ${count === 1 ? "session" : "sessions"}`;
  };
  function validDestination() {
    const selected = state.courses.find((item) => item.name === course);
    if (!selected) {
      setError("Choose an existing course.");
      return false;
    }
    if (unit && !selected.units.includes(unit)) {
      setError("Choose a unit in this course, or select No unit.");
      return false;
    }
    return true;
  }
  function createClass() {
    if (!validDestination()) return;
    setState((prev) => ({
      ...prev,
      classes: [
        {
          id: crypto.randomUUID(),
          title: classDate,
          customTitle: null,
          course,
          unit,
          date: classDate,
          status: "New",
        },
        ...prev.classes,
      ],
    }));
    announce("Session added to this sample.");
    router.push("/preview/class");
  }
  function addCourse() {
    if (!courseName.trim()) {
      setError("Give the course a name.");
      return;
    }
    if (state.courses.some((item) => item.name === courseName.trim())) {
      setError("That course already exists.");
      return;
    }
    setState((prev) => ({
      ...prev,
      courses: [...prev.courses, { id: crypto.randomUUID(), name: courseName.trim(), units: [] }],
    }));
    setCourse(courseName.trim());
    setUnit("");
    setCourseName("");
    setCreateCourseOpen(false);
    setError("");
    announce("Sample course created.");
  }
  function openClass(item: (typeof state.classes)[number], destination: string) {
    setState((previous) => ({
      ...previous,
      classes: [item, ...previous.classes.filter((other) => other.id !== item.id)],
    }));
    router.push(`/preview/${destination}`);
  }
  function addUnit() {
    if (!unitName.trim()) {
      setError("Give the unit a name.");
      return;
    }
    const selected = state.courses.find((item) => item.name === course);
    if (!selected) {
      setError("Choose an existing course first.");
      return;
    }
    if (selected.units.includes(unitName.trim())) {
      setError("That unit already exists in this course.");
      return;
    }
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((item) =>
        item.name === course
          ? { ...item, units: [...new Set([...item.units, unitName.trim()])] }
          : item,
      ),
    }));
    setUnit(unitName.trim());
    setUnitName("");
    setError("");
    announce("Sample unit created.");
  }
  function moveClass() {
    if (!lesson) return;
    if (!validDestination()) return;
    setState((prev) => ({
      ...prev,
      classes: prev.classes.map((item) =>
        item.id === lesson.id
          ? {
              ...item,
              course,
              unit,
              customTitle: name.trim() || null,
              title: sampleClassSummary(
                { ...item, customTitle: name.trim() || null },
                prev.materialMetadata,
              ).title,
            }
          : item,
      ),
    }));
    announce("Sample session updated.");
    router.push("/preview/class");
  }
  function renameCourse() {
    const next = courseName.trim();
    if (
      !state.courses.some((item) => item.name === course) ||
      !next ||
      course === "My Courses" ||
      state.courses.some((item) => item.name === next)
    ) {
      setError("Choose a new course name. My Courses is your permanent default.");
      return;
    }
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((item) => (item.name === course ? { ...item, name: next } : item)),
      classes: prev.classes.map((item) =>
        item.course === course ? { ...item, course: next } : item,
      ),
    }));
    setCourse(next);
    setCourseName("");
    setError("");
    announce("Sample course renamed.");
  }
  function renameUnit() {
    const next = unitName.trim();
    if (
      !state.courses.find((item) => item.name === course)?.units.includes(unit) ||
      !next ||
      state.courses.find((item) => item.name === course)?.units.includes(next)
    ) {
      setError("Choose an existing unit and a new unit name.");
      return;
    }
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((item) =>
        item.name === course
          ? { ...item, units: item.units.map((value) => (value === unit ? next : value)) }
          : item,
      ),
      classes: prev.classes.map((item) =>
        item.course === course && item.unit === unit ? { ...item, unit: next } : item,
      ),
    }));
    setUnit(next);
    setUnitName("");
    setError("");
    announce("Sample unit renamed.");
  }
  const rows = (items: typeof state.classes) => (
    <ul className={classStyles.list}>
      {items.map((item) => {
        const summary = summaryFor(item);
        return (
          <li key={item.id} className={classStyles.item}>
            <details className={classStyles.classDetails}>
              <summary className={classStyles.row}>
                <time className={classStyles.date} dateTime={item.date}>
                  {displayClassDate(item.date)}
                </time>
                <span className={classStyles.title} dir="auto">
                  {summary.title}
                </span>
                <svg
                  className={classStyles.chevron}
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
              <div className={classStyles.content}>
                <div className={classStyles.information}>
                  <h3 dir="auto">{summary.title}</h3>
                  <dl className={classStyles.metadata}>
                    <div>
                      <dt>Course</dt>
                      <dd>
                        <bdi>{item.course}</bdi>
                      </dd>
                    </div>
                    {item.unit ? (
                      <div>
                        <dt>Unit</dt>
                        <dd>
                          <bdi>{item.unit}</bdi>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="preview-muted">
                    <time dateTime={item.date}>{displayClassDate(item.date)}</time> ·{" "}
                    {titleStatus(summary.titleSource)} · {item.status}
                  </p>
                  {summary.topics.length ? (
                    <p>
                      <strong>Topics: </strong>
                      <bdi>{summary.topics.slice(0, 3).join(" · ")}</bdi>
                    </p>
                  ) : null}
                </div>
                <div className={classStyles.action}>
                  <Button className="rc-btn-block" onClick={() => openClass(item, "class")}>
                    Go to session
                  </Button>
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
  if (screen === "today")
    return (
      <>
        <PageHeader
          title="Your English, one class at a time."
          description="Pick up where you left off. A short review is enough for today."
        />
        <div className="preview-grid">
          <Panel tone="hero" title="Record a session">
            <Icon icon={Microphone} size={40} />
            <p>Keep useful moments from your next English class.</p>
            <Actions>
              <LinkButton to="recording">Record a session</LinkButton>
              <LinkButton secondary to="first-upload">
                Add a file
              </LinkButton>
            </Actions>
          </Panel>
          <Panel title="Ready for a little practice?">
            <Icon icon={Cards} size={32} />
            <p>
              {due
                ? `${due} sample cards are ready.`
                : "Nothing due in this sample. Choose cards from a session to practise."}
            </p>
            <Actions>
              <LinkButton secondary to={due ? "review" : "cards"}>
                {due ? "Start review" : "Choose cards"}
              </LinkButton>
            </Actions>
            <p className="preview-muted">
              A few minutes is enough. This sample does not calculate an FSRS schedule.
            </p>
          </Panel>
        </div>
        <Panel title="Your recent sessions">
          {state.classes.length ? (
            rows(recentClasses.slice(0, 2))
          ) : (
            <div className="preview-empty">
              <p>Your first session starts here.</p>
              <LinkButton to="new-class">New session</LinkButton>
            </div>
          )}
        </Panel>
        <div className="preview-row">
          <LinkButton secondary to="progress">
            View progress
          </LinkButton>
          <LinkButton secondary to="recovery">
            Try recording recovery
          </LinkButton>
        </div>
      </>
    );
  if (screen === "classes" || screen === "course")
    return (
      <>
        <PageHeader
          title={screen === "course" ? (selectedCourse?.name ?? "Your courses") : "Your courses"}
          description="Choose a course, then select a session to see its details."
          back={screen === "course" ? "classes" : undefined}
        />
        <div className={directoryStyles.directory}>
          <section className={directoryStyles.courseBar} aria-label="Choose your course">
            <div className={directoryStyles.courseIcon}>
              <Icon icon={ChalkboardSimple} size={28} />
            </div>
            <div className={directoryStyles.courseControl}>
              {state.courses.length > 1 ? (
                <Field label="Course">
                  <select
                    className="input"
                    value={courseFilter ?? ""}
                    onChange={(event) => {
                      const selected = event.target.value;
                      setCourseFilter(selected || null);
                      if (selected !== ALL_COURSES) setCourse(selected);
                      setVisibleCount(CLASS_BATCH_SIZE);
                      setMaterialsPage(0);
                      router.replace(`/preview/${screen}?course=${encodeURIComponent(selected)}`, {
                        scroll: false,
                      });
                    }}
                  >
                    <option value="" disabled>
                      Choose a course
                    </option>
                    {state.courses.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name} · {countClasses(item.name)}
                      </option>
                    ))}
                    <option value={ALL_COURSES}>All sessions</option>
                  </select>
                </Field>
              ) : (
                <div>
                  <p className={directoryStyles.courseLabel}>Course</p>
                  <h2 className={directoryStyles.courseName} dir="auto">
                    {selectedCourse?.name ?? "Your courses"}
                  </h2>
                </div>
              )}
            </div>
          </section>
          {hasSelection ? (
            <section className={directoryStyles.classes} aria-label="Session list">
              <div className={directoryStyles.listHeading}>
                <h2>{allCourses ? "All sessions" : "Sessions"}</h2>
                <p className="preview-muted">Most recent first · Select a session to see more</p>
              </div>
              {visible.length ? (
                rows(visible.slice(0, visibleCount))
              ) : (
                <div className={directoryStyles.empty}>
                  <h3>Your first session starts here</h3>
                  <p>Add a session, then keep its notes and flashcards together.</p>
                  <LinkButton to={newClassTo}>Create a session</LinkButton>
                </div>
              )}
              {visible.length ? (
                <div className={directoryStyles.listFooter}>
                  <p className="preview-muted" role="status" aria-live="polite">
                    {Math.min(visibleCount, visible.length)} of {visible.length}{" "}
                    {visible.length === 1 ? "session" : "sessions"}
                  </p>
                  {visibleCount < visible.length ? (
                    <div ref={classSentinel}>
                      <Button
                        secondary
                        onClick={() => setVisibleCount((count) => count + CLASS_BATCH_SIZE)}
                      >
                        Load more sessions
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : (
            <div className={directoryStyles.empty}>
              <h2>
                {state.courses.length
                  ? "Choose a course to see its sessions"
                  : "Add your first course"}
              </h2>
              <p>
                {state.courses.length
                  ? "Your sessions will appear here, ordered by date."
                  : "Keep each subject and its sessions together in a course."}
              </p>
              {!state.courses.length ? (
                <LinkButton to="organize">Create a course</LinkButton>
              ) : null}
            </div>
          )}
          <footer className={directoryStyles.tools}>
            {hasSelection ? (
              <Link className={directoryStyles.newClass} href={`/preview/${newClassTo}`}>
                + New session
              </Link>
            ) : null}
            <details ref={courseTools} className={directoryStyles.manage}>
              <summary>Course tools</summary>
              <Actions>
                <LinkButton secondary to="organize">
                  Manage courses and units
                </LinkButton>
                {selectedCourse && screen !== "course" ? (
                  <LinkButton
                    secondary
                    to={`course?course=${encodeURIComponent(selectedCourse.name)}#course-materials`}
                  >
                    Course materials
                  </LinkButton>
                ) : null}
              </Actions>
              {screen === "course" && selectedCourse ? (
                <div id="course-materials">
                  <Panel title="Course materials">
                    <p className="preview-muted">
                      Current sample notes from each session, from earliest to latest.
                    </p>
                    {courseSessions.length ? (
                      courseSessions.slice(materialsPage * 5, materialsPage * 5 + 5).map((item) => {
                        const content =
                          item.id === lesson?.id ? state : state.classWorkspaces[item.id];
                        return (
                          <article className="preview-panel" key={item.id}>
                            <p className="preview-muted">
                              <time dateTime={item.date}>{item.date}</time>
                            </p>
                            <h3 dir="auto">{summaryFor(item).title}</h3>
                            <p className="preview-muted">
                              {titleStatus(summaryFor(item).titleSource)}
                            </p>
                            {content?.materialMetadata ? (
                              <>
                                <p dir="auto">Material title: {content.materialMetadata.title}</p>
                                <p dir="auto">
                                  Topics: {content.materialMetadata.topics.join(" · ")}
                                </p>
                              </>
                            ) : null}
                            {content?.noteText.trim() ? (
                              <>
                                <p className="preview-muted">
                                  Current sample notes · Version {content.noteHistory.length}
                                  {content.noteHistory.at(-1)?.label
                                    ? ` · ${content.noteHistory.at(-1)?.label}`
                                    : ""}
                                </p>
                                <p dir="auto" className={learningStyles.edited}>
                                  {content.noteText}
                                </p>
                              </>
                            ) : (
                              <p className="preview-muted">
                                No notes yet. Open this session to add material.
                              </p>
                            )}
                            {content?.sources.length ? (
                              <p className="preview-muted">
                                Sample sources:{" "}
                                {content.sources.map((source) => source.name).join(" · ")}
                              </p>
                            ) : null}
                            <Actions>
                              <Button secondary onClick={() => openClass(item, "class")}>
                                Open session
                              </Button>
                              <Button secondary onClick={() => openClass(item, "notes")}>
                                Session notes
                              </Button>
                              <Button secondary onClick={() => openClass(item, "cards")}>
                                Cards
                              </Button>
                              <Button secondary onClick={() => openClass(item, "upload")}>
                                Sources
                              </Button>
                            </Actions>
                          </article>
                        );
                      })
                    ) : (
                      <p>Add a session to this course to start collecting its materials.</p>
                    )}
                    {courseSessions.length > 5 ? (
                      <Actions>
                        <Button
                          secondary
                          disabled={materialsPage === 0}
                          onClick={() => setMaterialsPage((value) => value - 1)}
                        >
                          Previous materials
                        </Button>
                        <p className="preview-muted">Page {materialsPage + 1}</p>
                        <Button
                          secondary
                          disabled={(materialsPage + 1) * 5 >= courseSessions.length}
                          onClick={() => setMaterialsPage((value) => value + 1)}
                        >
                          Next materials
                        </Button>
                      </Actions>
                    ) : null}
                  </Panel>
                </div>
              ) : null}
            </details>
          </footer>
        </div>
      </>
    );
  if (screen === "new-class")
    return (
      <div className="preview-reader">
        <PageHeader
          title="New session"
          description="Choose a course and date. The title will come from your learning material."
          back="classes"
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createClass();
          }}
        >
          <Field label="Session date" hint="Day / Month / Year">
            <DateInput required value={classDate} onChange={setClassDate} />
          </Field>
          <Field label="Course" hint={courseCopy.courseHelp}>
            <select
              value={course}
              onChange={(event) => {
                if (event.target.value === CREATE_NEW_COURSE) {
                  setError("");
                  setCreateCourseOpen(true);
                  return;
                }
                setCourse(event.target.value);
                setUnit("");
              }}
            >
              {state.courses.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
              <option value={CREATE_NEW_COURSE}>Create New Course</option>
            </select>
          </Field>
          <Field label="Unit (optional)">
            <select value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="">No unit</option>
              {state.courses
                .find((item) => item.name === course)
                ?.units.map((item) => (
                  <option key={item}>{item}</option>
                ))}
            </select>
          </Field>
          {error ? <Status tone="error">{error}</Status> : null}
          <Actions>
            <Button type="submit">Create session</Button>
            <LinkButton secondary to="classes">
              Cancel
            </LinkButton>
          </Actions>
        </form>
        <Sheet
          open={createCourseOpen}
          onClose={() => setCreateCourseOpen(false)}
          title="Create a course"
        >
          <p>{courseCopy.goalHelp}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addCourse();
            }}
          >
            <Field label="New course name">
              <input
                dir="auto"
                required
                autoComplete="off"
                maxLength={160}
                value={courseName}
                onChange={(event) => setCourseName(event.target.value)}
              />
            </Field>
            {error ? <Status tone="error">{error}</Status> : null}
            <Actions>
              <Button type="submit">Create course</Button>
              <Button secondary onClick={() => setCreateCourseOpen(false)}>
                Cancel
              </Button>
            </Actions>
          </form>
        </Sheet>
      </div>
    );
  if (screen === "class")
    return (
      <>
        <PageHeader
          title={lesson ? summaryFor(lesson).title : "Your session"}
          description={
            lesson
              ? `${lesson.course} · ${lesson.unit || "No unit"} · ${lesson.date}`
              : "Create a session to get started."
          }
          back="classes"
        />
        {lesson ? (
          <div className="preview-grid">
            <Panel tone="hero" title="Session notes">
              <Icon icon={FileText} size={32} />
              {notesAvailable ? (
                <>
                  <p dir="auto">
                    {state.noteText.slice(0, 180)}
                    {state.noteText.length > 180 ? "…" : ""}
                  </p>
                  <Actions>
                    <LinkButton to="notes">Read session notes</LinkButton>
                  </Actions>
                </>
              ) : (
                <>
                  <p>Your notes will appear here when session material is ready.</p>
                  <Actions>
                    <LinkButton to={state.sources.length ? "estimate" : "first-upload"}>
                      {state.sources.length ? "Prepare session notes" : "Add session material"}
                    </LinkButton>
                  </Actions>
                </>
              )}
            </Panel>
            <Panel title="Flashcards">
              <Icon icon={Cards} size={32} />
              <p>
                {state.cards.some((card) => card.classId === lesson.id)
                  ? "Practise the vocabulary and key ideas from this session."
                  : "Flashcards appear when this session has learning material."}
              </p>
              <Actions>
                <LinkButton to="cards">Open flashcards</LinkButton>
              </Actions>
            </Panel>
          </div>
        ) : null}
        <details className={directoryStyles.manage} open={!lesson}>
          <summary>Session tools and sources</summary>
          <Actions>
            {lesson ? (
              <>
                {state.sources.length ? (
                  <LinkButton to="first-upload">Add sources</LinkButton>
                ) : null}
                <LinkButton secondary to="organize">
                  Session options
                </LinkButton>
              </>
            ) : (
              <LinkButton to="new-class">New session</LinkButton>
            )}
          </Actions>
          {lesson ? (
            <Panel title="Session overview">
              <p className="preview-muted">
                <time dateTime={lesson.date}>{lesson.date}</time> ·{" "}
                {titleStatus(summaryFor(lesson).titleSource)}
              </p>
              {state.materialMetadata ? (
                <>
                  <p dir="auto">Material title: {state.materialMetadata.title}</p>
                  <p>Topics covered in this sample material:</p>
                  <ul>
                    {[...new Set(state.materialMetadata.topics)].map((topic) => (
                      <li key={topic} dir="auto">
                        {topic}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="preview-muted">Topics appear when session material is ready.</p>
              )}
            </Panel>
          ) : null}
          <Panel title="Session material">
            {state.sources.length ? (
              <>
                <ul className="preview-list">
                  {state.sources.map((source) => (
                    <li key={source.id}>
                      <div className="preview-row">
                        <span>
                          <Icon icon={FileText} /> {source.name}
                        </span>
                        <span className="preview-chip">{source.status}</span>
                      </div>
                      <p className="preview-muted">
                        {source.kind === "audio"
                          ? `${source.durationMinutes} audio minutes`
                          : `${source.pages} ${source.kind === "photo" ? "photo" : "pages"}`}
                      </p>
                    </li>
                  ))}
                </ul>
                <Actions>
                  <LinkButton secondary to="source-settings">
                    Choose sources
                  </LinkButton>
                  <LinkButton secondary to="estimate">
                    View estimate
                  </LinkButton>
                </Actions>
              </>
            ) : (
              <div className="preview-empty">
                <p>No sources in this session yet.</p>
                <p className="preview-muted">
                  Add a session recording, handout or photo to get started.
                </p>
                <LinkButton to={lesson ? "first-upload" : "new-class"}>
                  {lesson ? "Add sources" : "New session"}
                </LinkButton>
              </div>
            )}
          </Panel>
          {notesAvailable ? (
            <Panel title="Ready to continue">
              <p>Keep your own edits and check where each explanation came from.</p>
              <Actions>
                <LinkButton secondary to="history">
                  Note history
                </LinkButton>
                <LinkButton secondary to="export">
                  Export learning
                </LinkButton>
              </Actions>
            </Panel>
          ) : null}
        </details>
      </>
    );
  if (screen === "organize")
    return (
      <>
        <PageHeader
          title="Keep your sessions organised"
          description="Rename, move and arrange your sample sessions."
          back="classes"
        />
        <div className="preview-grid">
          <Panel title="Session details">
            <Field label="Move to course">
              <select
                value={course}
                onChange={(event) => {
                  setCourse(event.target.value);
                  setUnit("");
                }}
              >
                {state.courses.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Move to unit">
              <select value={unit} onChange={(event) => setUnit(event.target.value)}>
                <option value="">No unit</option>
                {state.courses
                  .find((item) => item.name === course)
                  ?.units.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
              </select>
            </Field>
            <Field
              label="Session name"
              hint="Optional custom title. Clear it to use the material title, or the date before material is ready."
            >
              <input
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={lesson?.title ?? "Create a session first"}
              />
            </Field>
            <Actions>
              <Button disabled={!lesson} onClick={moveClass}>
                Save changes
              </Button>
              <Button secondary disabled={!lesson} onClick={() => setConfirm("class")}>
                Delete sample session
              </Button>
            </Actions>
          </Panel>
          <Panel title="Courses and units">
            <Field label="New course name">
              <input value={courseName} onChange={(event) => setCourseName(event.target.value)} />
            </Field>
            <Button onClick={addCourse}>Create course</Button>
            <Button secondary disabled={course === "My Courses"} onClick={renameCourse}>
              Rename selected course
            </Button>
            <Field label="New unit name">
              <input value={unitName} onChange={(event) => setUnitName(event.target.value)} />
            </Field>
            <Button secondary onClick={addUnit}>
              Create unit in {course}
            </Button>
            <Button secondary disabled={!unit} onClick={renameUnit}>
              Rename selected unit
            </Button>
            <Actions>
              <Button
                secondary
                disabled={
                  course === "My Courses" || state.classes.some((item) => item.course === course)
                }
                onClick={() => setConfirm("course")}
              >
                Delete empty course
              </Button>
              <Button
                secondary
                disabled={
                  !unit ||
                  state.classes.some((item) => item.course === course && item.unit === unit)
                }
                onClick={() => setConfirm("unit")}
              >
                Delete empty unit
              </Button>
            </Actions>
            <p className="preview-muted">
              Only empty courses and units can be deleted. Move their sessions first. My Courses is
              your permanent default.
            </p>
          </Panel>
        </div>
        {error ? <Status tone="error">{error}</Status> : null}
        <Sheet
          open={!!confirm}
          onClose={() => setConfirm(null)}
          title={`Delete this sample ${confirmLabel ?? "item"}?`}
        >
          <p>
            This changes only the preview. You can restore the original sample with Reset sample.
          </p>
          <Actions>
            <Button
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  classes:
                    confirm === "class"
                      ? prev.classes.filter((item) => item.id !== lesson?.id)
                      : prev.classes,
                  courses:
                    confirm === "course"
                      ? prev.courses.filter((item) => item.name !== course)
                      : confirm === "unit"
                        ? prev.courses.map((item) =>
                            item.name === course
                              ? { ...item, units: item.units.filter((value) => value !== unit) }
                              : item,
                          )
                        : prev.courses,
                }));
                setConfirm(null);
                announce("Sample item deleted.");
                router.push("/preview/classes");
              }}
            >
              Delete sample {confirmLabel}
            </Button>
            <Button secondary onClick={() => setConfirm(null)}>
              Keep it
            </Button>
          </Actions>
        </Sheet>
      </>
    );
  return null;
}
