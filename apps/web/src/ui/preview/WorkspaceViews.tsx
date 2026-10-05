"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { courseCopy } from "../course-copy";
import { Cards, FileText, Folders, Microphone } from "../icons";
import learningStyles from "./LearningViews.module.css";
import { usePreview } from "./PreviewContext";
import { Actions, Button, Field, LinkButton, PageHeader, Panel, Status } from "./primitives";
import { sampleClassSummary, sampleCustomTitle } from "./sample-material";

export function WorkspaceViews({ screen }: { screen: string }) {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const lesson = state.classes[0];
  const [search, setSearch] = useState("");
  const [name, setName] = useState(
    screen === "organize" && lesson ? (sampleCustomTitle(lesson) ?? "") : "",
  );
  const [course, setCourse] = useState(lesson?.course ?? "My classes");
  const [unit, setUnit] = useState(screen === "organize" ? (lesson?.unit ?? "") : "");
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [classDate, setClassDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [unitName, setUnitName] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(0);
  const initializedCourseScreen = useRef<string | null>(null);
  useEffect(() => {
    if (screen !== "organize") return;
    if (!lesson?.id) {
      setName("");
      setCourse("My classes");
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
    setCourse(lesson?.course ?? "My classes");
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
    const fallback = state.courses.find((item) => item.name === "My classes") ?? state.courses[0];
    const initialize = initializedCourseScreen.current !== screen;
    setCourse((selected) =>
      screen === "new-class" && !initialize && state.courses.some((item) => item.name === selected)
        ? selected
        : (available?.name ?? current?.name ?? fallback?.name ?? "My classes"),
    );
    initializedCourseScreen.current = screen;
  }, [screen, lesson?.course, state.courses]);
  const filteredCourse = screen === "course" ? course : courseFilter;
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
  const visible = state.classes.filter(
    (item) =>
      (filteredCourse === null || item.course === filteredCourse) &&
      `${summaryFor(item).title} ${summaryFor(item).topics.join(" ")} ${item.course} ${item.unit}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  visible.sort(
    (left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
  );
  const courseSessions = state.classes
    .filter((item) => item.course === course)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const notesAvailable = state.noteText.trim().length > 0;
  const due = state.cards.filter((card) => card.status === "active").length;
  const countClasses = (selectedCourse: string) => {
    const count = state.classes.filter((item) => item.course === selectedCourse).length;
    return `${count} ${count === 1 ? "class" : "classes"}`;
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
          title: name.trim() || classDate,
          customTitle: name.trim() || null,
          course,
          unit,
          date: classDate,
          status: "New",
        },
        ...prev.classes,
      ],
    }));
    announce("Class added to this sample.");
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
    announce("Sample class updated.");
    router.push("/preview/class");
  }
  function renameCourse() {
    const next = courseName.trim();
    if (
      !state.courses.some((item) => item.name === course) ||
      !next ||
      course === "My classes" ||
      state.courses.some((item) => item.name === next)
    ) {
      setError("Choose a new course name. My classes is your permanent default.");
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
    <ul className="preview-list">
      {items.map((item) => {
        const summary = summaryFor(item);
        return (
          <li key={item.id}>
            <div className="preview-row">
              <div>
                <h3 dir="auto">{summary.title}</h3>
                <p className="preview-muted">
                  <time dateTime={item.date}>{item.date}</time> · {titleStatus(summary.titleSource)}
                </p>
                <p className="preview-muted">
                  {item.course}
                  {item.unit ? ` · ${item.unit}` : ""}
                </p>
                {summary.topics.length ? (
                  <p className="preview-muted">Topics: {summary.topics.slice(0, 3).join(" · ")}</p>
                ) : null}
                {summary.topics.length > 3 ? (
                  <Button secondary onClick={() => openClass(item, "class")}>
                    More topics
                  </Button>
                ) : null}
                <span className="preview-chip">{item.status}</span>
              </div>
              <Button secondary onClick={() => openClass(item, "class")}>
                Open class
              </Button>
            </div>
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
          <Panel tone="hero" title="Record a class">
            <Icon icon={Microphone} size={40} />
            <p>Keep useful moments from your next English class.</p>
            <Actions>
              <LinkButton to="recording">Record a class</LinkButton>
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
                : "Nothing due in this sample. Choose cards from a class to practise."}
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
        <Panel title="Your recent classes">
          {state.classes.length ? (
            rows(state.classes.slice(0, 2))
          ) : (
            <div className="preview-empty">
              <p>Your first class starts here.</p>
              <LinkButton to="new-class">New class</LinkButton>
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
          title={screen === "course" ? course : "Your classes"}
          description="Keep each lesson and its useful material together."
          back={screen === "course" ? "classes" : undefined}
        />
        <Actions>
          <LinkButton
            to={
              screen === "course" ? `new-class?course=${encodeURIComponent(course)}` : "new-class"
            }
          >
            New class
          </LinkButton>
          <LinkButton secondary to="organize">
            Manage courses and units
          </LinkButton>
          {screen === "course" ? (
            <LinkButton
              secondary
              to={`course?course=${encodeURIComponent(course)}#course-materials`}
            >
              Course materials
            </LinkButton>
          ) : null}
        </Actions>
        <p className="preview-muted">{courseCopy.courseHelp}</p>
        {screen === "course" ? (
          <Field label="Course">
            <select
              value={course}
              onChange={(event) => {
                const selected = event.target.value;
                setCourse(selected);
                setPage(0);
                setMaterialsPage(0);
                router.replace(`/preview/course?course=${encodeURIComponent(selected)}`);
              }}
            >
              {state.courses.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name} · {countClasses(item.name)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Search classes">
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Class, course or unit"
          />
        </Field>
        {screen === "classes" ? (
          <div className="preview-row">
            {state.courses.map((item) => (
              <Button
                key={item.id}
                secondary
                onClick={() => {
                  setCourseFilter(item.name);
                  setPage(0);
                }}
                aria-pressed={courseFilter === item.name}
              >
                <Icon icon={Folders} />
                {item.name} · {countClasses(item.name)}
              </Button>
            ))}
            <Button
              secondary
              aria-pressed={courseFilter === null}
              onClick={() => {
                setCourseFilter(null);
                setPage(0);
              }}
            >
              All classes
            </Button>
            {courseFilter ? (
              <LinkButton to={`course?course=${encodeURIComponent(courseFilter)}`} secondary>
                Open course
              </LinkButton>
            ) : null}
          </div>
        ) : null}
        <Panel
          title={
            visible.length
              ? `${visible.length} ${visible.length === 1 ? "class" : "classes"}`
              : "No classes here yet"
          }
        >
          {visible.length ? (
            rows(visible.slice(page * 5, page * 5 + 5))
          ) : (
            <div className="preview-empty">
              <p>
                {search
                  ? "Try a different search or add a class."
                  : "Add a lesson and keep its material in one place."}
              </p>
              <LinkButton
                to={
                  filteredCourse
                    ? `new-class?course=${encodeURIComponent(filteredCourse)}`
                    : "new-class"
                }
              >
                New class
              </LinkButton>
            </div>
          )}
          {visible.length > 5 ? (
            <Actions>
              <Button secondary disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span>Page {page + 1}</span>
              <Button
                secondary
                disabled={(page + 1) * 5 >= visible.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </Actions>
          ) : null}
        </Panel>
        {screen === "course" ? (
          <div id="course-materials">
            <Panel title="Course materials">
              <p className="preview-muted">
                Current sample notes from each class, from earliest to latest.
              </p>
              {courseSessions.length ? (
                courseSessions.slice(materialsPage * 5, materialsPage * 5 + 5).map((item) => {
                  const content = item.id === lesson?.id ? state : state.classWorkspaces[item.id];
                  return (
                    <article className="preview-panel" key={item.id}>
                      <p className="preview-muted">
                        <time dateTime={item.date}>{item.date}</time>
                      </p>
                      <h3 dir="auto">{summaryFor(item).title}</h3>
                      <p className="preview-muted">{titleStatus(summaryFor(item).titleSource)}</p>
                      {content?.materialMetadata ? (
                        <>
                          <p dir="auto">Material title: {content.materialMetadata.title}</p>
                          <p dir="auto">Topics: {content.materialMetadata.topics.join(" · ")}</p>
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
                          No notes yet. Open this class to add material.
                        </p>
                      )}
                      {content?.sources.length ? (
                        <p className="preview-muted">
                          Sample sources: {content.sources.map((source) => source.name).join(" · ")}
                        </p>
                      ) : null}
                      <Actions>
                        <Button secondary onClick={() => openClass(item, "class")}>
                          Open class
                        </Button>
                        <Button secondary onClick={() => openClass(item, "notes")}>
                          Class notes
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
                <p>Add a class to this course to start collecting its materials.</p>
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
      </>
    );
  if (screen === "new-class")
    return (
      <div className="preview-reader">
        <PageHeader
          title="New class"
          description="Choose a course and date for this class. The name is optional."
          back="classes"
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createClass();
          }}
        >
          <Field
            label="Class name (optional)"
            hint="Leave it empty for a title from class material. The date is shown until material is ready."
          >
            <input
              autoComplete="off"
              dir="auto"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example, Present perfect"
            />
          </Field>
          <Field label="Class date">
            <input
              type="date"
              required
              value={classDate}
              onChange={(event) => setClassDate(event.target.value)}
            />
          </Field>
          <Field label="Course" hint={courseCopy.courseHelp}>
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
          <Actions>
            <Button
              secondary
              onClick={() => {
                setError("");
                setCreateCourseOpen(true);
              }}
            >
              Create course
            </Button>
          </Actions>
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
            <Button type="submit">Create class</Button>
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
          title={lesson ? summaryFor(lesson).title : "Your class"}
          description={
            lesson
              ? `${lesson.course} · ${lesson.unit || "No unit"} · ${lesson.date}`
              : "Create a class to get started."
          }
          back="classes"
        />
        <Actions>
          {lesson ? (
            <>
              {state.sources.length ? <LinkButton to="first-upload">Add sources</LinkButton> : null}
              <LinkButton secondary to="organize">
                Class options
              </LinkButton>
            </>
          ) : (
            <LinkButton to="new-class">New class</LinkButton>
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
              <p className="preview-muted">Topics appear when class material is ready.</p>
            )}
          </Panel>
        ) : null}
        <div className="preview-grid">
          <Panel title="Class material">
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
                <p>No sources in this class yet.</p>
                <p className="preview-muted">
                  Add a class recording, handout or photo to get started.
                </p>
                <LinkButton to={lesson ? "first-upload" : "new-class"}>
                  {lesson ? "Add sources" : "New class"}
                </LinkButton>
              </div>
            )}
          </Panel>
          <Panel title="Your learning">
            {notesAvailable ? (
              <>
                <p
                  className={
                    state.noteHistory.length > 1
                      ? "preview-provenance-edit"
                      : "preview-provenance-class"
                  }
                >
                  {state.noteHistory.length > 1 ? "Edited by you" : "From this class"}
                </p>
                <div className="preview-note-preview">
                  <p>
                    {state.noteText.slice(0, 220)}
                    {state.noteText.length > 220 ? "…" : ""}
                  </p>
                </div>
                <p className="preview-muted">
                  These notes belong to this sample class. Check explanations against your class
                  material.
                </p>
                <Actions>
                  <LinkButton to="notes">Read notes</LinkButton>
                  <LinkButton secondary to="cards">
                    Suggested cards
                  </LinkButton>
                </Actions>
              </>
            ) : (
              <div className="preview-empty">
                <p>Your notes will appear here.</p>
                <p className="preview-muted">
                  Add class material, then process it to prepare notes for this class.
                </p>
                {state.sources.length ? <LinkButton to="estimate">Prepare notes</LinkButton> : null}
              </div>
            )}
          </Panel>
        </div>
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
      </>
    );
  if (screen === "organize")
    return (
      <>
        <PageHeader
          title="Keep your classes organised"
          description="Rename, move and arrange your sample classes."
          back="classes"
        />
        <div className="preview-grid">
          <Panel title="Class details">
            <Field
              label="Class name"
              hint="Optional custom title. Clear it to use the material title, or the date before material is ready."
            >
              <input
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={lesson?.title ?? "Create a class first"}
              />
            </Field>
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
            <Actions>
              <Button disabled={!lesson} onClick={moveClass}>
                Save changes
              </Button>
              <Button secondary disabled={!lesson} onClick={() => setConfirm("class")}>
                Delete sample class
              </Button>
            </Actions>
          </Panel>
          <Panel title="Courses and units">
            <Field label="New course name">
              <input value={courseName} onChange={(event) => setCourseName(event.target.value)} />
            </Field>
            <Button onClick={addCourse}>Create course</Button>
            <Button secondary disabled={course === "My classes"} onClick={renameCourse}>
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
                  course === "My classes" || state.classes.some((item) => item.course === course)
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
              Only empty courses and units can be deleted. Move their classes first. My classes is
              your permanent default.
            </p>
          </Panel>
        </div>
        {error ? <Status tone="error">{error}</Status> : null}
        <Sheet
          open={!!confirm}
          onClose={() => setConfirm(null)}
          title={`Delete this sample ${confirm ?? "item"}?`}
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
              Delete sample {confirm}
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
