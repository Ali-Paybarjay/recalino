import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { LOCAL_ADMIN_DATABASE_URL } from "../../../packages/core/test/local-db";
import type { AdminSnapshot } from "../src/ui/admin/contracts";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

type OwnerRow = { user_id: string; enabled: boolean; created_at: Date };
const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

/** This fixture can provision only the public development database on this computer. */
async function withLocalOwner(page: Page, run: (userId: string, db: pg.Client) => Promise<void>) {
  const browserUrl = new URL(test.info().project.use.baseURL ?? "");
  const authUrl = new URL(process.env.SUPABASE_URL ?? "");
  const databaseUrl = new URL(LOCAL_ADMIN_DATABASE_URL);
  if (
    !loopback(browserUrl.hostname) ||
    !loopback(authUrl.hostname) ||
    !loopback(databaseUrl.hostname)
  )
    throw new Error("Admin fixtures require local browser, local Auth and local Postgres.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  await page.addInitScript(() => localStorage.setItem("recalino.admin.locale", "en"));
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  const db = new pg.Client({ connectionString: LOCAL_ADMIN_DATABASE_URL });
  await db.connect();
  let previous: OwnerRow | undefined;
  let provisioned = false;
  try {
    previous = (
      await db.query<OwnerRow>(
        "select user_id, enabled, created_at from plt.admin_owner where singleton=true",
      )
    ).rows[0];
    await db.query(
      "insert into plt.admin_owner(singleton,user_id,enabled) values(true,$1,true) on conflict(singleton) do update set user_id=excluded.user_id,enabled=true",
      [userId],
    );
    provisioned = true;
    await run(userId, db);
    expect(runtimeErrors, "Owner UI console and hydration errors").toEqual([]);
  } finally {
    try {
      if (provisioned && previous)
        await db.query(
          "update plt.admin_owner set user_id=$1,enabled=$2,created_at=$3 where singleton=true",
          [previous.user_id, previous.enabled, previous.created_at],
        );
      else if (provisioned)
        await db.query("delete from plt.admin_owner where singleton=true and user_id=$1", [userId]);
    } finally {
      await db.end();
    }
  }
}

test.describe("Owner administration", () => {
  test.describe.configure({ mode: "serial", timeout: 120000 });

  test("anonymous API access is 401 and a genuine nonowner is 404", async ({ page }) => {
    expect((await page.request.get("/api/admin?view=overview")).status()).toBe(401);
    await signInAsNewLearner(page, { setup: "complete" });
    expect((await page.request.get("/api/admin?view=overview")).status()).toBe(404);
    await page.goto("/admin");
    // Next streams notFound UI with HTTP 200; API denial above remains a strict 404.
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Admin navigation", exact: true }),
    ).toHaveCount(0);
  });

  test("live overview and user allocation review support EN, FA RTL and mobile", async ({
    page,
  }) => {
    await withLocalOwner(page, async (userId) => {
      const overviewResponse = await page.request.get("/api/admin?view=overview");
      expect(overviewResponse.status()).toBe(200);
      const overview = (await overviewResponse.json()) as AdminSnapshot;
      expect(overview.pilot).toBeDefined();
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
      await expect(
        page.getByText(`${overview.pilot?.admitted} / ${overview.pilot?.capacity}`, {
          exact: true,
        }),
      ).toBeVisible();
      await expectNoAxeViolations(page);

      const userResponse = await page.request.get(`/api/admin?view=user&userId=${userId}`);
      expect(userResponse.status()).toBe(200);
      const user = (await userResponse.json()) as AdminSnapshot;
      expect(user.user?.id).toBe(userId);
      await page.goto(`/admin#view=user&userId=${userId}`);
      await page
        .getByRole("button", {
          name: user.quota?.entitlementId ? "Adjust allocation" : "Admit to pilot",
          exact: true,
        })
        .click();
      const values = [
        ["Audio minutes", "دقیقهٔ صوت", "2000"],
        ["Document pages", "صفحهٔ سند", "300"],
        ["Regenerations", "تولید مجدد", "100"],
        ["TTS characters", "نویسهٔ گفتار", "200000"],
        ["Storage · MiB", "فضا · MiB", "1536"],
      ] as const;
      for (const [label, , value] of values)
        await page.getByLabel(label, { exact: true }).fill(value);
      await page
        .getByLabel("Reason for this allocation", { exact: true })
        .fill("Local allocation review; no mutation approved");
      await page.getByRole("button", { name: "فارسی", exact: true }).last().click();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const [, label, value] of values)
        await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
      await page.getByRole("button", { name: "بازبینی تخصیص", exact: true }).click();
      await expect(
        page.getByRole("columnheader", { name: "تخصیص تازه", exact: true }),
      ).toBeVisible();
      await page.setViewportSize(VIEWPORTS.mobile);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      expect(await page.locator("main").innerText()).not.toContain("\uFFFD");
      const screenshotPath = test.info().outputPath("admin-fa-mobile.png");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await test
        .info()
        .attach("admin-fa-mobile", { path: screenshotPath, contentType: "image/png" });
      await page.getByRole("button", { name: "English", exact: true }).last().click();
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      for (const [label, , value] of values)
        await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
      await expect(
        page.getByRole("button", { name: "Confirm & save allocation", exact: true }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expectNoAxeViolations(page);

      await page.goto("/admin#view=pilot");
      await page.getByLabel("Maximum admissions", { exact: true }).fill("0");
      await page
        .getByLabel("Reason for change", { exact: true })
        .fill("Preview zero capacity; existing accounts retained");
      await page.getByRole("button", { name: "Review capacity change", exact: true }).click();
      await expect(
        page.getByText(
          "New admissions will pause. Existing accounts, allowance and history stay intact.",
          { exact: true },
        ),
      ).toBeVisible();
      // These reviews must not change server allocation or capacity before owner confirmation.
      const after = (await (
        await page.request.get("/api/admin?view=pilot")
      ).json()) as AdminSnapshot;
      expect(after.pilot?.capacity).toBe(overview.pilot?.capacity);
    });
  });

  test("exact email preview persists edits across language changes without queueing mail", async ({
    page,
  }) => {
    await withLocalOwner(page, async (userId, db) => {
      const user = (await (
        await page.request.get(`/api/admin?view=user&userId=${userId}`)
      ).json()) as AdminSnapshot;
      expect(user.user?.email).toBeTruthy();
      const actions: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin")
          actions.push((request.postDataJSON() as { action: string }).action);
      });
      await page.goto(`/admin#view=user&userId=${userId}`);
      await page.getByRole("button", { name: "Send email", exact: true }).click();
      await page.getByLabel("Template", { exact: true }).selectOption("");
      await page.getByLabel("Subject", { exact: true }).fill("Exact local preview");
      await page
        .getByLabel("Message", { exact: true })
        .fill("A reviewed message. <script>text remains plain</script>\n{{custom_note}}");
      await page
        .getByLabel("Variable text · custom_note", { exact: true })
        .fill("Additional reviewed detail.");
      await page.getByRole("button", { name: "فارسی", exact: true }).last().click();
      await expect(page.getByLabel("موضوع", { exact: true })).toHaveValue("Exact local preview");
      await expect(page.getByLabel("متن متغیر · custom_note", { exact: true })).toHaveValue(
        "Additional reviewed detail.",
      );
      await page.getByRole("button", { name: "آماده‌کردن پیش‌نمایش دقیق", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "بازبینی و تأیید", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Exact local preview", exact: true }),
      ).toBeVisible();
      const previewMessage = page
        .locator('div[dir="auto"]')
        .filter({ hasText: "Additional reviewed detail." });
      await expect(previewMessage).toHaveText(
        "A reviewed message. <script>text remains plain</script>\nAdditional reviewed detail.",
      );
      await expect(page.getByRole("button", { name: /تأیید و ارسال برای/ })).toBeEnabled();
      expect(actions).toEqual(["email.preview"]);
      const outbox = await db.query<{ count: string }>(
        "select count(*) from support.email_outbox where user_id=$1",
        [userId],
      );
      expect(Number(outbox.rows[0]?.count)).toBe(0);
      await page.setViewportSize(VIEWPORTS.mobile);
      await expectNoAxeViolations(page);
    });
  });
});
