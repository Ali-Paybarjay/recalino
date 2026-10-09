import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { generateCards } from "@recalino/core/card";
import { createDatabase } from "@recalino/core/db";
import { publishKnowledgeVersion } from "@recalino/core/lkm";
import { publishNotebook } from "@recalino/core/note";
import { createSession } from "@recalino/core/org";
import { submitReview } from "@recalino/core/srs";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

const output = resolve(import.meta.dirname, "../../../artifacts/verification/d49-teaching-memory");
const day = 86400000;

/** Synthetic lesson, cards and two Forgot answers on local Postgres only (no AI, no pilot data). */
async function seed(userId: string) {
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  try {
    const ctx = { userId, requestId: randomUUID() };
    const start = new Date(Date.now() - 4 * day);
    const session = await createSession(
      db,
      ctx,
      { classDate: "2026-10-05" },
      { key: randomUUID() },
    );
    const model = referenceStudyModel();
    await db.transaction().execute((tx) =>
      publishKnowledgeVersion(
        tx,
        ctx,
        {
          sessionId: session.id,
          runId: randomUUID(),
          sourcesVersion: 0,
          sourceFingerprint: "d49-browser",
          model,
          sources: [],
          explanationLanguage: model.language.explanation,
          generation: {
            mode: "mock",
            teachingAdaptation: {
              version: 1,
              declaredLevel: "B1",
              shorterExamples: false,
              simplerExplanations: true,
              focus: [
                {
                  target: "wear and tear",
                  reason: "recall_difficulty",
                  scope: "same_course",
                  againCount: 2,
                  lastEvidenceDate: "2026-10-04",
                  sourceSessionId: randomUUID(),
                },
              ],
              linkedItemIds: ["wear-tear"],
            },
          },
        },
        start,
      ),
    );
    await publishNotebook(db, ctx, session.id, { expectedRevisionId: null }, { key: randomUUID() });
    const { cards } = await generateCards(
      db,
      ctx,
      session.id,
      { autoAdd: true },
      { key: randomUUID(), now: start },
    );
    const card = cards.find((entry) => entry.learningItemId && entry.front.includes("______"));
    if (!card) throw new Error("Missing production card");
    let version = 0;
    for (const offset of [1, 2]) {
      const receipt = await submitReview(
        db,
        ctx,
        {
          eventId: randomUUID(),
          cardId: card.id,
          expectedVersion: version,
          expectedContentVersion: card.contentVersion,
          mode: "simple",
          choice: "forgot",
        },
        new Date(start.getTime() + offset * day),
      );
      version = receipt.version;
    }
    return { session };
  } finally {
    await db.destroy();
  }
}

test("D49 practice notes are evidence-backed, correctable, and the lesson teaches with a hidden check", async ({
  page,
}) => {
  test.setTimeout(180000);
  await mkdir(output, { recursive: true });
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const { session } = await seed(userId);
  for (const [width, name] of [
    [390, "phone"],
    [1440, "desktop"],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/me/learning");
    const practice = page.getByRole("region", { name: "Suggested for more practice" });
    await expect(practice).toBeVisible();
    await expect(practice.getByText(/You chose Again or Forgot 2 times/)).toBeVisible();
    await expect(page.getByText(/Latest answer considered:/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your next step" })).toBeVisible();
    await page.screenshot({ path: `${output}/your-learning-${name}.png`, fullPage: true });
  }
  await expectNoAxeViolations(page);
  const corrected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/learning/feedback") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "This isn't a difficulty for me" }).first().click();
  expect((await corrected).status()).toBe(200);
  await expect(page.getByText("Your correction is saved.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "You said these aren't difficulties" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Suggested for more practice" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Show it again" }).click();
  await expect(page.getByRole("region", { name: "Suggested for more practice" })).toBeVisible();

  for (const [width, name] of [
    [390, "phone"],
    [1440, "desktop"],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/classes/${session.id}/notes`);
    await page.getByText("Prepared for you").click();
    await expect(page.getByText(/“wear and tear” appears in this lesson/)).toBeVisible();
    await expect(page.getByText("Simpler explanations (your choice)")).toBeVisible();
    const frame = page.frameLocator('iframe[title^="Class notes:"]');
    // The synthetic lesson explains in Persian, so the document chrome is Persian.
    await frame.locator('nav a[href="#check"]').click();
    const check = frame.locator("#check");
    await expect(check.getByText("پیش از تمام کردن این درس", { exact: false })).toBeVisible();
    const first = check.locator("ol.gaps > li").first();
    await expect(first.locator("details p.model")).toBeHidden();
    await expect(check.locator("p.key")).toBeHidden();
    await page.screenshot({ path: `${output}/class-notes-check-${name}.png`, fullPage: false });
    await first.locator("details summary").click();
    await expect(first.locator("details p.model")).toBeVisible();
    await page.screenshot({ path: `${output}/class-notes-answer-${name}.png`, fullPage: false });
    await first.locator('details a[href^="#"]').click();
    await expect(frame.locator("#core")).toBeVisible();
  }
});
