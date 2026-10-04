import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.2 AA, the target of FR-PLT-012. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page: Page) {
  // Next streams page metadata after the page body during development.
  await expect.poll(() => page.title()).not.toBe("");
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // The Next.js development overlay is not part of the app.
    .exclude("nextjs-portal")
    .analyze();
  const violations = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
  expect(violations).toEqual([]);
}

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 900, height: 900 },
  desktop: { width: 1440, height: 900 },
} as const;
