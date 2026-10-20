import type { ClassSession, Course, Unit } from "@recalino/core/org";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClassForm } from "./ClassForm";
import { CourseManager } from "./CourseManager";
import { PrivacyView } from "./PrivacyView";
import { Button } from "./primitives";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../recording/RecordingProvider", () => ({
  useRecording: () => ({
    controller: { prepareAccountDeletion: vi.fn() },
    state: { phase: "idle" },
    store: {},
    userId: "10000000-0000-4000-8000-000000000002",
  }),
}));

const owner = "10000000-0000-4000-8000-000000000002";
const course: Course = {
  id: "10000000-0000-4000-8000-000000000003",
  ownerId: owner,
  name: "ESOL Entry 3",
  isDefault: false,
  createdAt: "2026-10-01T00:00:00Z",
};
const unit: Unit = {
  id: "10000000-0000-4000-8000-000000000004",
  ownerId: owner,
  courseId: course.id,
  name: "Unit 4",
  position: 1,
  createdAt: "2026-10-01T00:00:00Z",
};
const session: ClassSession = {
  id: "10000000-0000-4000-8000-000000000005",
  ownerId: owner,
  courseId: course.id,
  unitId: null,
  title: "Present perfect",
  classDate: "2026-10-01",
  displayTitle: "Present perfect",
  sourcesVersion: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

/** The class attribute of every button whose text starts with `label`. */
function buttonClasses(html: string, label: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)]
    .filter((match) => (match[2] ?? "").startsWith(label))
    .map((match) => /class="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "");
}

// UI-05: the button that confirms a deletion has the danger look, never the primary one.
describe("deletion confirm buttons", () => {
  it("the shared button maps `danger` to the danger variant", () => {
    const html = renderToStaticMarkup(createElement(Button, { danger: true }, "Delete"));
    expect(html).toContain("rc-btn-danger");
    expect(html).not.toContain("btn-primary");
    expect(renderToStaticMarkup(createElement(Button, null, "Go"))).toContain("btn-primary");
    expect(renderToStaticMarkup(createElement(Button, { secondary: true }, "Go"))).toContain(
      "btn-secondary",
    );
  });

  it("Delete session in the confirm sheet", () => {
    const html = renderToStaticMarkup(
      createElement(ClassForm, {
        courses: [course],
        units: [unit],
        today: "2026-10-18",
        initial: session,
      }),
    );
    const classes = buttonClasses(html, "Delete session");
    expect(classes.length).toBeGreaterThan(0);
    for (const value of classes) expect(value).not.toContain("btn-primary");
    expect(classes.some((value) => value.includes("rc-btn-danger"))).toBe(true);
  });

  it("Delete course and unit in the confirm sheet", () => {
    const html = renderToStaticMarkup(
      createElement(CourseManager, { courses: [course], units: [unit], courseId: course.id }),
    );
    const classes = buttonClasses(html, "Delete");
    expect(classes.length).toBeGreaterThan(0);
    for (const value of classes) expect(value).not.toContain("btn-primary");
    // Both labels of the sheet button ("Delete group" before a choice is made) are danger.
    expect(classes.some((value) => value.includes("rc-btn-danger"))).toBe(true);
  });

  it("Delete account in the confirm sheet", () => {
    const html = renderToStaticMarkup(createElement(PrivacyView));
    const classes = buttonClasses(html, "Delete account");
    expect(classes).toHaveLength(1);
    expect(classes[0]).toContain("rc-btn-danger");
    expect(classes[0]).not.toContain("btn-primary");
  });
});
