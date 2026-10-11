import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDatabase } from "@recalino/core/db";
import type { LessonReviewView } from "@recalino/core/eval";
import { publishKnowledgeVersion } from "@recalino/core/lkm";
import { publishNotebook } from "@recalino/core/note";
import { createSession } from "@recalino/core/org";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

/** Local synthetic notes; every review request is intercepted, so no AI is called. */
async function seed(userId: string, edited = false, newerProposal = false) {
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  try {
    const ctx = { userId, requestId: randomUUID() };
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic lesson review" },
      { key: randomUUID() },
    );
    const model = referenceStudyModel();
    delete model.classNotes;
    const publish = () =>
      db.transaction().execute((tx) =>
        publishKnowledgeVersion(
          tx,
          ctx,
          {
            sessionId: session.id,
            runId: randomUUID(),
            sourcesVersion: 0,
            sourceFingerprint: randomUUID(),
            model,
            sources: [],
            explanationLanguage: model.language.explanation,
            generation: { mode: "mock" },
          },
          new Date(),
        ),
      );
    const version = await publish();
    await publishNotebook(
      db,
      ctx,
      session.id,
      {
        expectedRevisionId: null,
        ...(edited ? { edits: { title: "My edited lesson title" } } : {}),
      },
      { key: randomUUID() },
    );
    if (newerProposal) await publish();
    return { sessionId: session.id, versionId: version.id, title: model.title };
  } finally {
    await db.destroy();
  }
}

function report(versionId: string, overrides: Partial<LessonReviewView> = {}): LessonReviewView {
  return {
    runId: randomUUID(),
    knowledgeVersionId: versionId,
    knowledgeVersion: 1,
    state: "ready",
    lastError: null,
    reviewerModel: "synthetic-reviewer",
    rubricVersion: "lesson-review-1",
    createdAt: "2026-10-11T10:00:00.000Z",
    verdict: "no_major_issues_found",
    response: {
      rubricVersion: "lesson-review-1",
      checks: (
        [
          "source_grounding",
          "educational_correctness",
          "exercise_quality",
          "learner_fit",
          "coverage",
        ] as const
      ).map((criterion) => ({
        criterion,
        status: "satisfactory",
        reason: "Synthetic supported check.",
        findings: [],
      })),
    },
    ...overrides,
  };
}

test("AC-EE-07/08 opens with reads only, requests once, and shows a versioned advisory report", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const fixture = await seed(userId);
  const complete = report(fixture.versionId);
  const writes: { body: unknown; key: string | undefined }[] = [];
  let activeReads = 0;
  await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      await route.fulfill({
        status: 202,
        json: { runId: complete.runId, knowledgeVersionId: fixture.versionId },
      });
    } else {
      expect(new URL(request.url()).searchParams.get("versionId")).toBe(fixture.versionId);
      await route.fulfill({
        json: writes.length
          ? ++activeReads > 1
            ? complete
            : { ...complete, state: "processing", response: null, verdict: null }
          : null,
      });
    }
  });
  await page.goto(`/sessions/${fixture.sessionId}/notes`);
  const panel = page.getByRole("region", { name: "Lesson quality review" });
  const start = panel.getByRole("button", { name: "Review generated lesson", exact: true });
  await expect(start).toBeEnabled();
  expect(writes).toEqual([]);
  await expect(page.getByRole("heading", { name: fixture.title, exact: true })).toBeVisible();
  await start.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    panel.getByText("The lesson review is queued. You can keep reading your notes."),
  ).toBeVisible();
  // The mock completes after two 2.5 s polling cycles, beyond CI's default 5 s assertion budget.
  await expect(panel.getByText("No major issues found by AI", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  expect(writes).toEqual([
    {
      body: { knowledgeVersionId: fixture.versionId },
      key: expect.stringMatching(/^[\da-f-]{36}$/),
    },
  ]);
  await expect(panel.getByText("Generated lesson version 1", { exact: true })).toBeVisible();
  await expect(panel.getByText(/not human approval or a test of your level/)).toBeVisible();
  await expect(
    panel.getByText("This reviews the original generated lesson. Your edits are not included."),
  ).toBeVisible();
  for (const label of [
    "Support from the sources",
    "Teaching accuracy",
    "Exercises and hidden answers",
    "Fit with your chosen level",
    "Coverage of the selected material",
  ])
    await expect(panel.locator("summary").filter({ hasText: label })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: test.info().outputPath(`lesson-review-${width}-${theme}.png`),
      });
    }
  }
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(panel.getByText("No major issues found by AI", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
});

for (const previousFailure of [false, true]) {
  test(`AC-EE-05 retains the request key after a lost acknowledgement (earlier failure: ${previousFailure})`, async ({
    page,
  }) => {
    const { userId } = await signInAsNewLearner(page, { setup: "complete" });
    const fixture = await seed(userId);
    const complete = report(fixture.versionId);
    const earlier = previousFailure
      ? report(fixture.versionId, { state: "failed", response: null, verdict: null })
      : null;
    const keys: (string | undefined)[] = [];
    await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
      if (route.request().method() === "POST") {
        keys.push(route.request().headers()["idempotency-key"]);
        if (keys.length === 1) await route.abort("failed");
        else
          await route.fulfill({
            status: 202,
            json: { runId: complete.runId, knowledgeVersionId: fixture.versionId },
          });
      } else await route.fulfill({ json: keys.length > 1 ? complete : earlier });
    });
    await page.goto(`/sessions/${fixture.sessionId}/notes`);
    const panel = page.getByRole("region", { name: "Lesson quality review" });
    await panel
      .getByRole("button", {
        name: previousFailure ? "Try lesson review again" : "Review generated lesson",
        exact: true,
      })
      .click();
    await expect(panel.getByRole("alert")).toContainText("The request could not be confirmed");
    await panel.getByRole("button", { name: "Check review status", exact: true }).click();
    await panel.getByRole("button", { name: "Retry review request", exact: true }).click();
    await expect(panel.getByText("No major issues found by AI", { exact: true })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[\da-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });
}

test("AC-EE-07 follows the latest review when another tab retries the requested run", async ({
  page,
}) => {
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const fixture = await seed(userId);
  const requested = report(fixture.versionId, {
    state: "processing",
    response: null,
    verdict: null,
  });
  const latest = report(fixture.versionId, { createdAt: "2026-10-11T10:05:00.000Z" });
  let writes = 0;
  let activeReads = 0;
  await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      await route.fulfill({
        status: 202,
        json: { runId: requested.runId, knowledgeVersionId: fixture.versionId },
      });
    } else {
      // Between these polls the first run failed and another tab requested a newer review.
      await route.fulfill({ json: writes ? (++activeReads === 1 ? requested : latest) : null });
    }
  });
  await page.goto(`/sessions/${fixture.sessionId}/notes`);
  const panel = page.getByRole("region", { name: "Lesson quality review" });
  await panel.getByRole("button", { name: "Review generated lesson", exact: true }).click();
  await expect(panel.getByText("No major issues found by AI", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    panel.getByText("The lesson review is queued. You can keep reading your notes."),
  ).toHaveCount(0);
  expect(activeReads).toBeGreaterThanOrEqual(2);
  expect(writes).toBe(1);
});

test("AC-EE-06/07 stops showing a queued review when its lesson becomes unavailable", async ({
  page,
}) => {
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const fixture = await seed(userId);
  let writes = 0;
  await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      await route.fulfill({
        status: 202,
        json: { runId: randomUUID(), knowledgeVersionId: fixture.versionId },
      });
    } else if (writes) {
      await route.fulfill({
        status: 404,
        json: { error: { code: "not_found", message: "We couldn't find that." } },
      });
    } else await route.fulfill({ json: null });
  });
  await page.goto(`/sessions/${fixture.sessionId}/notes`);
  const panel = page.getByRole("region", { name: "Lesson quality review" });
  await panel.getByRole("button", { name: "Review generated lesson", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("no longer available");
  await expect(
    panel.getByText("The lesson review is queued. You can keep reading your notes."),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Review generated lesson", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
});

test("AC-EE-01/04 keeps the original saved version distinct from edits and newer generated material", async ({
  page,
}) => {
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const fixture = await seed(userId, true, true);
  const complete = report(fixture.versionId, { verdict: "needs_attention" });
  if (!complete.response) throw new Error("Synthetic review missing");
  complete.response.checks[2] = {
    criterion: "exercise_quality",
    status: "concern",
    reason: "The example needs a clearer prompt.",
    findings: [
      {
        targetId: "practice-1",
        quote: "<script>window.reviewInjected = true</script>",
        evidenceKeys: ["evidence-1"],
        explanation: "Synthetic finding displayed as text.",
        suggestion: "پاسخ را تا زمانی که زبان‌آموز درخواست نکرده نمایش ندهید.",
      },
    ],
  };
  let posts = 0;
  await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
    if (route.request().method() === "POST") posts++;
    expect(new URL(route.request().url()).searchParams.get("versionId")).toBe(fixture.versionId);
    await route.fulfill({ json: complete });
  });
  await page.goto(`/sessions/${fixture.sessionId}/notes`);
  const panel = page.getByRole("region", { name: "Lesson quality review" });
  await expect(panel.getByText("Generated lesson version 1", { exact: true })).toBeVisible();
  await expect(
    panel.getByText(
      "These notes contain your edits. This report only covers the original generated lesson.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My edited lesson title", exact: true }),
  ).toBeVisible();
  await panel.locator("summary").filter({ hasText: "Exercises and hidden answers" }).click();
  await expect(panel.getByText("Synthetic finding displayed as text.")).toBeVisible();
  await expect(
    panel.getByText("پاسخ را تا زمانی که زبان‌آموز درخواست نکرده نمایش ندهید.", { exact: true }),
  ).toHaveCSS("direction", "rtl");
  await expect(
    panel.getByText("“<script>window.reviewInjected = true</script>”", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => "reviewInjected" in window)).toBe(false);
  expect(posts).toBe(0);
});

for (const state of ["needs_input", "failed", "ready"] as const) {
  test(`AC-EE-04/05 handles ${state} without inventing a passing review`, async ({ page }) => {
    const { userId } = await signInAsNewLearner(page, { setup: "complete" });
    const fixture = await seed(userId);
    const saved = report(fixture.versionId, {
      state,
      response: null,
      verdict: null,
      lastError: state === "needs_input" ? "provider_outcome_unknown" : "synthetic_failure",
    });
    let posts = 0;
    await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ json: saved });
    });
    await page.goto(`/sessions/${fixture.sessionId}/notes`);
    const panel = page.getByRole("region", { name: "Lesson quality review" });
    await expect(
      panel.getByRole("button", { name: "Check review status", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByText("No major issues found by AI", { exact: true })).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Try lesson review again", exact: true }),
    ).toHaveCount(state === "failed" ? 1 : 0);
    if (state === "needs_input")
      await expect(panel.getByText(/contact the operator before requesting/)).toBeVisible();
    await panel.getByRole("button", { name: "Check review status", exact: true }).click();
    expect(posts).toBe(0);
  });
}

test("AC-EE-01/07 rejects a report returned for another generated version", async ({ page }) => {
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const fixture = await seed(userId);
  await page.route(`**/api/classes/${fixture.sessionId}/lesson-review**`, async (route) => {
    await route.fulfill({ json: report(randomUUID()) });
  });
  await page.goto(`/sessions/${fixture.sessionId}/notes`);
  const panel = page.getByRole("region", { name: "Lesson quality review" });
  await expect(panel.getByRole("alert")).toContainText("The saved review could not be loaded");
  await expect(panel.getByText("No major issues found by AI", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Review generated lesson", exact: true }),
  ).toHaveCount(0);
});
