import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { LOCAL_ADMIN_DATABASE_URL } from "../../../packages/core/test/local-db";
import type { AdminEmail, AdminSnapshot } from "../src/ui/admin/contracts";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

type OwnerRow = { user_id: string; enabled: boolean; created_at: Date };
const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

/** This fixture can provision only the public development database on this computer. */
async function withLocalOwner(
  page: Page,
  run: (userId: string, db: pg.Client) => Promise<void>,
  expectedValidationErrors = 0,
) {
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
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem("recalino.admin.locale", "en");
  });
  const runtimeErrors: string[] = [];
  let validationConsoleErrors = 0;
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    // Browser automation attempts to inject utility scripts into opaque srcdoc frames.
    // The preview deliberately blocks these; its DOM is separately checked to contain no scripts.
    const blockedPreviewUtility =
      message.text() ===
      "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.";
    const expectedApiValidation =
      expectedValidationErrors > 0 &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 400 (Bad Request)" &&
      new URL(message.location().url || page.url()).pathname === "/api/admin";
    if (expectedApiValidation) validationConsoleErrors++;
    else if (message.type() === "error" && !blockedPreviewUtility)
      runtimeErrors.push(message.text());
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
    expect(
      validationConsoleErrors,
      "Only explicitly tested API validation responses may log 400 errors",
    ).toBeLessThanOrEqual(expectedValidationErrors);
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
      await page.getByLabel("Email language", { exact: true }).selectOption("en");
      await page.getByLabel("Subject", { exact: true }).fill("Exact local preview");
      await page
        .getByLabel("Message", { exact: true })
        .fill("A reviewed message. <script>text remains plain</script>\n{{custom_note}}");
      await page.getByText("Advanced options", { exact: true }).click();
      await page
        .getByLabel("Variable text · custom_note", { exact: true })
        .fill("Additional reviewed detail.");
      await page.getByLabel("Email heading (optional)", { exact: true }).fill("Learning, together");
      await page
        .getByLabel("Inbox preview line (optional)", { exact: true })
        .fill("Your reviewed update from Recalino.");
      await page.getByLabel("Include an action button", { exact: true }).check();
      await page.getByLabel("Button text", { exact: true }).fill("Open my learning space");
      await page.getByLabel("Button link", { exact: true }).fill("https://recalino.vercel.app");
      await page.getByLabel("Email language", { exact: true }).selectOption("fa");
      await page.getByLabel("Subject", { exact: true }).fill("پیام آزمایشی فارسی");
      await page.getByLabel("Message", { exact: true }).fill("سلام، این نسخهٔ فارسی مستقل است.");
      await page.getByLabel("Email heading (optional)", { exact: true }).fill("یادگیری در کنار هم");
      await page.getByLabel("Email language", { exact: true }).selectOption("en");
      await expect(page.getByLabel("Email heading (optional)", { exact: true })).toHaveValue(
        "Learning, together",
      );
      await expect(page.getByLabel("Button text", { exact: true })).toHaveValue(
        "Open my learning space",
      );
      await page.getByLabel("Email language", { exact: true }).selectOption("fa");
      await expect(page.getByLabel("Email heading (optional)", { exact: true })).toHaveValue(
        "یادگیری در کنار هم",
      );
      await page.getByLabel("Email language", { exact: true }).selectOption("en");
      await page.getByRole("button", { name: "فارسی", exact: true }).last().click();
      await expect(page.getByLabel("موضوع", { exact: true })).toHaveValue("Exact local preview");
      await expect(page.getByLabel("متن متغیر · custom_note", { exact: true })).toHaveValue(
        "Additional reviewed detail.",
      );
      await expect(page.getByLabel("عنوان داخل ایمیل (اختیاری)", { exact: true })).toHaveValue(
        "Learning, together",
      );
      await page.getByRole("button", { name: "پیش‌نمایش ایمیل", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "بازبینی و تأیید", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Exact local preview", exact: true }),
      ).toBeVisible();
      const previewFrame = page.getByTitle("پیش‌نمایش طرح ایمیل برای تأیید", { exact: true });
      await expect(previewFrame).toHaveAttribute("sandbox", "");
      await expect(previewFrame).toHaveAttribute("referrerpolicy", "no-referrer");
      const email = page.frameLocator('iframe[title="پیش‌نمایش طرح ایمیل برای تأیید"]');
      await expect(
        email.getByRole("heading", { name: "Learning, together", exact: true }),
      ).toBeVisible();
      await expect(
        email.getByRole("link", { name: "Open my learning space", exact: true }),
      ).toHaveAttribute("data-preview-href", "https://recalino.vercel.app/");
      await expect(email.locator("a[href]")).toHaveCount(0);
      await expect(email.locator("script")).toHaveCount(0);
      await expect(
        email.getByText("A reviewed message. <script>text remains plain</script>", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(email.getByRole("img", { name: "Recalino", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "پیش‌نمایش موبایل", exact: true }).click();
      expect(
        await previewFrame.evaluate((element) => element.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(360);
      const previewPath = test.info().outputPath("branded-email-composer-mobile.png");
      await previewFrame.screenshot({ path: previewPath });
      await test
        .info()
        .attach("branded-email-composer-mobile", { path: previewPath, contentType: "image/png" });
      await page.getByRole("button", { name: "متن ساده", exact: true }).click();
      const previewMessage = page
        .locator('div[dir="auto"]')
        .filter({ hasText: "Additional reviewed detail." });
      await expect(previewMessage).toContainText(
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
  test("routine emails need only preview and approval, with extra options collapsed", async ({
    page,
  }) => {
    await withLocalOwner(page, async (userId, db) => {
      const user = (await (
        await page.request.get(`/api/admin?view=user&userId=${userId}`)
      ).json()) as AdminSnapshot;
      const requests: {
        templateId: string;
        language: string;
        localizedVariables?: Record<string, Record<string, string>>;
      }[] = [];
      await page.route("**/api/admin", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const request = route.request().postDataJSON() as {
          action: string;
          input: (typeof requests)[number];
        };
        expect(request.action).toBe("email.preview");
        requests.push(request.input);
        await route.fulfill({
          json: {
            preview: {
              previewId: `synthetic-ready-${requests.length}`,
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              recipients: [
                {
                  userId,
                  name: "Synthetic learner",
                  email: user.user?.email ?? "synthetic@example.test",
                  language: "fa",
                  subject: "ایمیل آمادهٔ ریکالینو",
                  body: "پیام آماده با لینک اپ و جزئیات پیش‌فرض.",
                },
              ],
              excluded: [],
            },
          },
        });
      });
      await page.goto(`/admin#view=user&userId=${userId}`);
      await page.getByRole("button", { name: "فارسی", exact: true }).last().click();
      await page.getByRole("button", { name: "ارسال ایمیل", exact: true }).click();
      await expect(page.getByLabel("زبان ایمیل", { exact: true })).toHaveValue("recipient");
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      await expect(page.getByLabel("دلیل داخلی (اختیاری)", { exact: true })).not.toBeVisible();
      await expect(
        page.getByLabel("عنوان داخل ایمیل (اختیاری)", { exact: true }),
      ).not.toBeVisible();
      await page.setViewportSize(VIEWPORTS.desktop);
      const desktopPath = test.info().outputPath("simple-email-fa-desktop.png");
      await page.screenshot({ path: desktopPath, fullPage: true });
      await test
        .info()
        .attach("simple-email-fa-desktop", { path: desktopPath, contentType: "image/png" });
      await page.setViewportSize(VIEWPORTS.mobile);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const mobilePath = test.info().outputPath("simple-email-fa-mobile.png");
      await page.screenshot({ path: mobilePath, fullPage: true });
      await test
        .info()
        .attach("simple-email-fa-mobile", { path: mobilePath, contentType: "image/png" });
      await page.getByRole("button", { name: "پیش‌نمایش ایمیل", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "بازبینی و تأیید", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /تأیید و ارسال برای/ })).toBeEnabled();
      await expect(page.getByLabel("موضوع", { exact: true })).not.toBeVisible();
      await expect(page.getByRole("button", { name: "پیش‌نمایش ایمیل", exact: true })).toHaveCount(
        0,
      );
      expect(requests[0]).toMatchObject({ templateId: "pilot_welcome", language: "recipient" });
      await page.getByRole("button", { name: "ویرایش پیام", exact: true }).click();
      await page.getByLabel("قالب", { exact: true }).selectOption("pilot_invitation");
      await expect(page.getByLabel("گام بعدی", { exact: true })).not.toBeVisible();
      await page.getByRole("button", { name: "پیش‌نمایش ایمیل", exact: true }).click();
      await expect(page.getByRole("button", { name: /تأیید و ارسال برای/ })).toBeEnabled();
      expect(requests[1]?.localizedVariables?.fa?.next_step_text?.trim().length).toBeGreaterThan(0);
      expect(requests[1]?.localizedVariables?.en?.next_step_text?.trim().length).toBeGreaterThan(0);
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      const outbox = await db.query<{ count: string }>(
        "select count(*) from support.email_outbox where user_id=$1",
        [userId],
      );
      expect(Number(outbox.rows[0]?.count)).toBe(0);
    });
  });
  test("approved email results refresh delivery states and explain Gmail failure without resending", async ({
    page,
  }) => {
    await withLocalOwner(page, async (userId, db) => {
      const user = (await (
        await page.request.get(`/api/admin?view=user&userId=${userId}`)
      ).json()) as AdminSnapshot;
      let scenario = "sent";
      let polls = 0;
      let badStatusRead = false;
      const actions: string[] = [];
      const queued: AdminEmail = {
        id: "07b37693-5a53-4632-9fdd-d470b95aa21e",
        userId,
        email: user.user?.email ?? "synthetic@example.test",
        subject: "Synthetic tracked invitation",
        state: "queued",
        createdAt: new Date().toISOString(),
        lastError: null,
        retryAllowed: false,
      };
      await page.route("**/api/admin**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && url.searchParams.has("emailIds")) {
          expect(url.searchParams.get("view")).toBe("history");
          expect(url.searchParams.get("emailIds")).toBe(queued.id);
          polls++;
          if (badStatusRead)
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: "invalid-json",
            });
          const state = scenario === "sent" && polls === 1 ? "sending" : scenario;
          return route.fulfill({
            json: {
              view: "history",
              emails: [
                {
                  ...queued,
                  state,
                  lastError:
                    state === "failed"
                      ? "smtp_authentication_rejected"
                      : state === "unknown"
                        ? "smtp_result_unverified"
                        : null,
                  retryAllowed: state === "failed",
                },
              ],
            },
          });
        }
        if (request.method() !== "POST") return route.continue();
        const payload = request.postDataJSON() as { action: string };
        actions.push(payload.action);
        if (payload.action === "email.preview")
          return route.fulfill({
            json: {
              preview: {
                previewId: "d045a1d0-0e0a-4f7d-bd4f-3e831cb702b2:1",
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
                recipients: [
                  {
                    userId,
                    name: "Synthetic learner",
                    email: queued.email,
                    language: "en",
                    subject: queued.subject,
                    body: "An approved synthetic invitation.",
                  },
                ],
                excluded: [],
              },
            },
          });
        expect(payload.action).toBe("email.send");
        return route.fulfill({ status: 202, json: { ok: true, emails: [queued] } });
      });
      for (const state of ["sent", "failed", "unknown"]) {
        scenario = state;
        polls = 0;
        await page.goto(`/admin#view=user&userId=${userId}`);
        await page.getByRole("button", { name: "Send email", exact: true }).click();
        await page.getByRole("button", { name: "Preview email", exact: true }).click();
        await page.getByRole("button", { name: /Approve & send to/ }).click();
        await expect(
          page.getByRole("heading", { name: "Approved email results", exact: true }),
        ).toBeVisible();
        const row = page.getByRole("row").filter({ hasText: queued.subject });
        await expect(
          row.getByText(state === "sent" ? "Sent" : state === "failed" ? "Failed" : "Unconfirmed", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByText("Updating email status…", { exact: true })).toHaveCount(0);
        expect(polls).toBe(state === "sent" ? 2 : 1);
        if (state === "failed") {
          const failure = page.getByRole("alert").filter({ hasText: queued.email });
          await expect(failure.getByText(/Gmail rejected the sender’s sign-in/)).toBeVisible();
          await expect(
            failure.getByRole("button", { name: "Review retry", exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "فارسی", exact: true }).last().click();
          await expect(failure.getByText(/این ایمیل ارسال نشد/)).toBeVisible();
          await expect(
            failure.getByText("smtp_authentication_rejected", { exact: true }),
          ).toHaveCount(0);
          await page.setViewportSize(VIEWPORTS.mobile);
          await expectNoAxeViolations(page);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true);
          const screenshotPath = test
            .info()
            .outputPath("email-delivery-auth-failure-fa-mobile.png");
          await page.screenshot({ path: screenshotPath, fullPage: true });
          await test.info().attach("email-delivery-auth-failure-fa-mobile", {
            path: screenshotPath,
            contentType: "image/png",
          });
          await page.setViewportSize(VIEWPORTS.desktop);
          await page.getByRole("button", { name: "English", exact: true }).last().click();
          badStatusRead = true;
          await page.getByRole("button", { name: "Refresh email status", exact: true }).click();
          await expect(page.getByText(/The status could not be refreshed/)).toBeVisible();
          await expect(failure.getByText(/this email was not sent/)).toBeVisible();
          await expect(row.getByText("Failed", { exact: true })).toBeVisible();
          badStatusRead = false;
        }
        if (state === "unknown") {
          await expect(page.getByText(/There is no automatic retry/)).toBeVisible();
          await expect(page.getByRole("button", { name: "Review retry", exact: true })).toHaveCount(
            0,
          );
          await page.getByRole("button", { name: "Refresh email status", exact: true }).click();
          await expect.poll(() => polls).toBe(2);
          await expect(page.getByText("Updating email status…", { exact: true })).toHaveCount(0);
          expect(polls).toBe(2);
        }
      }
      expect(actions).toEqual([
        "email.preview",
        "email.send",
        "email.preview",
        "email.send",
        "email.preview",
        "email.send",
      ]);
      const outbox = await db.query<{ count: string }>(
        "select count(*) from support.email_outbox where user_id=$1",
        [userId],
      );
      expect(Number(outbox.rows[0]?.count)).toBe(0);
    });
  });
  test("custom emails show only the missing field after preview is attempted", async ({ page }) => {
    await withLocalOwner(page, async (userId) => {
      const requests: Record<string, unknown>[] = [];
      await page.route("**/api/admin", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const request = route.request().postDataJSON() as {
          action: string;
          input: Record<string, unknown>;
        };
        expect(request.action).toBe("email.preview");
        requests.push(request.input);
        await route.fulfill({
          json: {
            preview: {
              previewId: "synthetic-custom",
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              recipients: [],
              excluded: [],
            },
          },
        });
      });
      await page.goto(`/admin#view=user&userId=${userId}`);
      await page.getByRole("button", { name: "Send email", exact: true }).click();
      await page.getByLabel("Template", { exact: true }).selectOption("");
      await page.getByLabel("Email language", { exact: true }).selectOption("en");
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "Preview email", exact: true }).click();
      await expect(page.locator("main").getByRole("alert")).toHaveText(
        "Enter a subject for this email.",
      );
      await expect(page.getByLabel("Subject", { exact: true })).toBeFocused();
      expect(requests).toEqual([]);
      await page.getByLabel("Subject", { exact: true }).fill("Reviewed custom message");
      await page.getByLabel("Message", { exact: true }).fill("Hello\n\n{{custom_note}}");
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "Preview email", exact: true }).click();
      await expect(page.getByLabel("Variable text · custom_note", { exact: true })).toBeFocused();
      await expect(page.locator("main").getByRole("alert")).toContainText("custom_note");
      expect(requests).toEqual([]);
      await page
        .getByLabel("Variable text · custom_note", { exact: true })
        .fill("A personal detail.");
      await page
        .getByLabel("Additional message (optional)", { exact: true })
        .fill("A shared note.");
      await page.getByLabel("Email language", { exact: true }).selectOption("recipient");
      await page.getByRole("button", { name: "Preview email", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Review & approve", exact: true }),
      ).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        language: "recipient",
        localizedContent: {
          en: {
            subject: "Reviewed custom message",
            body: "Hello\n\n{{custom_note}}\n\nA shared note.",
          },
        },
      });
      expect((requests[0]?.localizedContent as Record<string, unknown> | undefined)?.fa).toEqual({
        subject: "",
        body: "\n\nA shared note.",
      });
      expect(requests[0]?.subject).toBeUndefined();
      expect(requests[0]?.body).toBeUndefined();
      expect(requests[0]?.presentation).toBeUndefined();
      await expectNoAxeViolations(page);
    });
  });
  test("recipient preference ignores an unused invalid translation and validates the actual recipient language", async ({
    page,
  }) => {
    await withLocalOwner(
      page,
      async (userId, db) => {
        const setPreference = async (language: "en" | "fa") => {
          // This is the newly generated, loopback-only fixture, never a cloud or existing account.
          await db.query(
            "update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('language',$2::text) where id=$1",
            [userId, language],
          );
        };
        await setPreference("en");
        await page.goto(`/admin#view=user&userId=${userId}`);
        await page.getByRole("button", { name: "Send email", exact: true }).click();
        await page.getByLabel("Template", { exact: true }).selectOption("");
        await page.getByLabel("Subject", { exact: true }).fill("Reviewed English message");
        await page
          .getByLabel("Message", { exact: true })
          .fill("A complete synthetic English message.");
        await page.getByRole("button", { name: "Edit Persian", exact: true }).click();
        await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("");
        await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
        await page.getByText("Advanced options", { exact: true }).click();
        await page.getByLabel("Include an action button", { exact: true }).check();
        await page.getByLabel("Button text", { exact: true }).fill("");
        await page.getByLabel("Button link", { exact: true }).fill("javascript:alert(1)");
        const firstResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/admin" &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Preview email", exact: true }).click();
        expect((await firstResponse).status()).toBe(200);
        await expect(
          page.getByRole("heading", { name: "Reviewed English message", exact: true }),
        ).toBeVisible();
        await expect(page.getByText("English · LTR", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /Approve & send to/ })).toBeEnabled();
        await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
        await page.getByRole("button", { name: "Edit message", exact: true }).click();
        await setPreference("fa");
        const nextResponse = async (field: string) => {
          const pending = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/admin" &&
              response.request().method() === "POST",
          );
          await page.getByRole("button", { name: "Preview email", exact: true }).click();
          const response = await pending;
          expect(response.status()).toBe(400);
          expect((await response.json()).error.details.fields[field]).toBeDefined();
          await expect(page.getByRole("button", { name: /Approve & send to/ })).toHaveCount(0);
          await expect(page.locator("main").getByRole("alert")).toContainText("فارسی");
        };
        await nextResponse("localizedContent.fa.subject");
        await expect(page.getByLabel("Subject", { exact: true })).toBeFocused();
        await expect(page.getByLabel("Subject", { exact: true })).toHaveAttribute("lang", "fa");
        await page.getByLabel("Subject", { exact: true }).fill("پیام فارسی بررسی‌شده");
        await nextResponse("localizedContent.fa.body");
        await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
        await page
          .getByLabel("Message", { exact: true })
          .fill("این پیام فارسی مصنوعی برای آزمون است.");
        await nextResponse("localizedPresentation.fa.action.label");
        await expect(page.getByLabel("Button text", { exact: true })).toBeFocused();
        await page.getByLabel("Button text", { exact: true }).fill("ورود به ریکالینو");
        await nextResponse("localizedPresentation.fa.action.url");
        await expect(page.getByLabel("Button link", { exact: true })).toBeFocused();
        await page.getByLabel("Button link", { exact: true }).fill("https://recalino.example.test");
        const finalResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/admin" &&
            response.request().method() === "POST",
          { timeout: 45_000 },
        );
        await page.getByRole("button", { name: "Preview email", exact: true }).click();
        expect((await finalResponse).status()).toBe(200);
        await expect(
          page.getByRole("heading", { name: "پیام فارسی بررسی‌شده", exact: true }),
        ).toBeVisible();
        await expect(page.getByText("فارسی · RTL", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /Approve & send to/ })).toBeEnabled();
        const outbox = await db.query<{ count: string }>(
          "select count(*) from support.email_outbox where user_id=$1",
          [userId],
        );
        expect(Number(outbox.rows[0]?.count)).toBe(0);
        await page.getByRole("button", { name: "Plain text", exact: true }).click();
        await expectNoAxeViolations(page);
      },
      4,
    );
  });
  test("reply email has a frozen Persian preview and editing invalidates approval", async ({
    page,
  }) => {
    await withLocalOwner(page, async (userId, db) => {
      await page.goto("/help/new");
      await page.getByLabel("Subject", { exact: true }).fill("Synthetic branded reply");
      await page.getByLabel("Your message", { exact: true }).fill("A local test question.");
      await page.getByLabel("Email me when there is a reply", { exact: false }).check();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page).toHaveURL(/\/help\/[a-f0-9-]+\?received=1$/);
      const threadId = new URL(page.url()).pathname.split("/").at(-1);
      await page.goto(`/admin#view=thread&threadId=${threadId}`);
      await page.getByLabel("Reply language", { exact: true }).selectOption("fa");
      await page
        .getByLabel("Reply", { exact: true })
        .fill("سلام، پاسخ آزمایشی ریکالینو برای شما آماده است.");
      await page
        .getByLabel("Button link", { exact: true })
        .fill(`https://recalino.example.test/help/${threadId}`);
      await page.getByRole("button", { name: "Review reply", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Approve & send reply", exact: true }),
      ).toBeEnabled();
      const email = page.frameLocator('iframe[title="Approved email design preview"]');
      await expect(email.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(email.getByRole("link", { name: "مشاهدهٔ گفت‌وگو", exact: true })).toHaveAttribute(
        "data-preview-href",
        new RegExp(`/help/${threadId}$`),
      );
      await expect(email.locator("a[href]")).toHaveCount(0);
      await expect(email.locator("script")).toHaveCount(0);
      await expect(email.getByRole("img", { name: "Recalino", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Mobile preview", exact: true }).click();
      await page.setViewportSize(VIEWPORTS.mobile);
      const previewPath = test.info().outputPath("branded-reply-fa-mobile.png");
      await page
        .getByTitle("Approved email design preview", { exact: true })
        .screenshot({ path: previewPath });
      await test
        .info()
        .attach("branded-reply-fa-mobile", { path: previewPath, contentType: "image/png" });
      await page
        .getByLabel("Reply", { exact: true })
        .fill("پاسخ ویرایش شد و به پیش‌نمایش تازه نیاز دارد.");
      await expect(page.getByRole("button", { name: "Review reply", exact: true })).toBeVisible();
      await expect(page.getByTitle("Approved email design preview", { exact: true })).toHaveCount(
        0,
      );
      const outbox = await db.query<{ count: string }>(
        "select count(*) from support.email_outbox where user_id=$1",
        [userId],
      );
      expect(Number(outbox.rows[0]?.count)).toBe(0);
      await page.setViewportSize(VIEWPORTS.mobile);
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  });
});
