import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { LOCAL_ADMIN_DATABASE_URL } from "../../../packages/core/test/local-db";
import type { AutomaticLearningStatus } from "../src/ui/workspace/automatic-learning";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

const sessionId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
for (const view of ["notice", "progress"] as const) {
  test(`${view}: requests the linked class review once and follows real continuation`, async ({
    page,
  }) => {
    let status: AutomaticLearningStatus = {
      state: "blocked",
      revision: 1,
      batchId: null,
      run: null,
      snapshot: null,
      lastError: "processing_budget_session",
      message: "This class's processing needs review.",
      notesReady: false,
      cardsReady: false,
      processingReview: {
        state: "not_requested",
        runId,
        requestedRunId: null,
        requestedAt: null,
        updatedAt: "2026-10-08T10:00:00.000Z",
        errorCode: "processing_budget_session",
        canRequest: true,
      },
    };
    const writes: unknown[] = [],
      unexpected: string[] = [];
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname !== `/api/classes/${sessionId}/learning`) {
        unexpected.push(route.request().url());
        await route.fulfill({ status: 501, json: {} });
        return;
      }
      if (route.request().method() === "POST") {
        const review = status.processingReview;
        if (!review) throw new Error("Synthetic processing review is missing");
        writes.push(route.request().postDataJSON());
        expect(route.request().headers()["idempotency-key"]).toMatch(/^[\da-f-]{36}$/);
        status = {
          ...status,
          processingReview: {
            ...review,
            state: "awaiting_review",
            requestedAt: "2026-10-08T10:01:00.000Z",
            requestedRunId: runId,
            canRequest: false,
          },
        };
      }
      await route.fulfill({ json: status });
    });
    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto(`/dev/ui/learning${view === "progress" ? "?view=progress" : ""}`);
    const request = page.getByRole("button", { name: "Request processing review", exact: true });
    await expect(request).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry after service/ })).toHaveCount(0);
    const bounds = await request.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await request.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(request).toHaveCount(0);
    expect(writes).toEqual([{ action: "request_review", runId }]);
    if (view === "notice") {
      await expect(
        page.getByRole("link", { name: "View processing review", exact: true }),
      ).toHaveAttribute("href", `/sessions/${sessionId}/sources#processing-review`);
    } else {
      await expect(page.getByText(/Your request is recorded for this session/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Add material", exact: true })).toHaveCount(0);
      await expectNoAxeViolations(page);
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.screenshot({
          path: test.info().outputPath(`processing-review-${theme}.png`),
          fullPage: true,
        });
      }
      const review = status.processingReview;
      if (!review) throw new Error("Synthetic processing review is missing");
      status = {
        ...status,
        state: "processing",
        lastError: null,
        message: "Creating your notes and flashcards automatically…",
        processingReview: { ...review, state: "retrying" },
      };
      await page.getByRole("button", { name: "Check review status", exact: true }).click();
      await expect(
        page.getByText(/Processing is continuing with your saved material/),
      ).toBeVisible();
      status = {
        ...status,
        state: "ready",
        notesReady: true,
        cardsReady: true,
        message: "Your notes and flashcards are up to date.",
        processingReview: { ...review, state: "resolved", partialResult: true },
      };
      await page.getByRole("button", { name: "Check review status", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Open session notes", exact: true }),
      ).toHaveAttribute("href", `/sessions/${sessionId}/notes`);
      await expect(
        page.getByText(/notes and flashcards are available with some source limitations/),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Request processing review", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Retry failed attempt", exact: true }),
      ).toHaveCount(0);
    }
    expect(writes).toHaveLength(1);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}

test("admin processing and cost deep links retain the selected run and class title", async ({
  page,
}) => {
  const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  for (const value of [
    test.info().project.use.baseURL ?? "",
    process.env.SUPABASE_URL ?? "",
    LOCAL_ADMIN_DATABASE_URL,
  ])
    if (!loopback(new URL(value).hostname))
      throw new Error("Only localhost browser/Auth/database fixtures are permitted.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const create = await page.request.post("/api/classes", {
    data: { title: "Synthetic processing review class" },
    headers: { "Idempotency-Key": randomUUID() },
  });
  expect(create.status(), await create.text()).toBe(201);
  const session = (await create.json()) as { id: string };
  const db = new pg.Client({ connectionString: LOCAL_ADMIN_DATABASE_URL });
  await db.connect();
  const previous = (
    await db.query("select user_id,enabled,created_at from plt.admin_owner where singleton=true")
  ).rows[0];
  const syntheticRunId = randomUUID();
  try {
    await db.query(
      "insert into proc.processing_run(id,user_id,session_id,operation_key,request_hash,sources_version,source_fingerprint,input_snapshot,settings,requested_amounts,reservation_id,state,last_error) values($1,$2,$3,$4,'synthetic-review',0,$5,'{}','{}','{}',$6,'failed','processing_budget_session')",
      [syntheticRunId, userId, session.id, randomUUID(), "a".repeat(64), randomUUID()],
    );
    await db.query(
      "insert into plt.admin_owner(singleton,user_id,enabled) values(true,$1,true) on conflict(singleton) do update set user_id=excluded.user_id,enabled=true",
      [userId],
    );
    await page.addInitScript(() => localStorage.setItem("recalino.admin.locale", "en"));
    await page.goto(`/admin#view=processing&runId=${syntheticRunId}`);
    await expect(
      page.getByRole("heading", { name: "Synthetic processing review class", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(syntheticRunId, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Review this session's costs and limits", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`view=costs&runId=${syntheticRunId}$`));
    await expect(
      page.getByRole("heading", { name: "Synthetic processing review class", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to this processing review", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`view=processing&runId=${syntheticRunId}$`));
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Synthetic processing review class", exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  } finally {
    if (previous)
      await db.query(
        "update plt.admin_owner set user_id=$1,enabled=$2,created_at=$3 where singleton=true",
        [previous.user_id, previous.enabled, previous.created_at],
      );
    else
      await db.query("delete from plt.admin_owner where singleton=true and user_id=$1", [userId]);
    await db.end();
  }
});
