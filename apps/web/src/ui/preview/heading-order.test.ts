import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountViews } from "./AccountViews";
import { LearningViews } from "./LearningViews";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/preview",
}));
// The provider opens its children only after an effect; a static render needs the sample state.
vi.mock("./PreviewContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("./PreviewContext")>();
  const value = {
    state: original.createSampleState(),
    setState: vi.fn(),
    reset: vi.fn(),
    announce: vi.fn(),
    message: "",
  };
  return { ...original, usePreview: () => value };
});

// A11Y-04: axe's heading-order rule. A page starts at level 1 and a heading is never more than one
// level deeper than the one before it.
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
}
function expectOrdered(levels: number[]) {
  expect(levels[0]).toBe(1);
  levels.forEach((level, index) => {
    if (index > 0)
      expect(level, `heading ${index + 1} of ${levels.join(",")}`).toBeLessThanOrEqual(
        (levels[index - 1] ?? 0) + 1,
      );
  });
}

describe("preview frames keep headings in order", () => {
  it.each([
    ["cards", LearningViews],
    ["card-types", LearningViews],
    ["legal", AccountViews],
  ] as const)("/preview/%s", (screen, view) => {
    const levels = headingLevels(renderToStaticMarkup(createElement(view, { screen })));
    expect(levels.length).toBeGreaterThan(1);
    expectOrdered(levels);
  });
});
