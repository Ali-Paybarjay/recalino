import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";

// A1 — FR-ACC-001, FR-ACC-002 and FR-PLT-001 in the browser. Google itself is not reached: the
// redirect to Supabase's Google sign-in is stopped and checked.

test("both boxes start unticked and the button says why it is unavailable", async ({ page }) => {
  await page.goto("/");
  const adult = page.getByRole("checkbox", { name: "I am 18 or older" });
  const terms = page.getByRole("checkbox", { name: "I accept the Terms and Privacy Notice" });
  const button = page.getByRole("button", { name: "Continue with Google" });
  await expect(adult).not.toBeChecked();
  await expect(terms).not.toBeChecked();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toHaveAccessibleDescription(/Please tick both boxes to continue\./);

  await page.getByText("I am 18 or older").click();
  await page.getByText("I accept the", { exact: true }).click();
  await expect(adult).toBeChecked();
  await expect(terms).toBeChecked();
  await expect(button).not.toHaveAttribute("aria-disabled");
  await expect(button).toHaveAccessibleDescription("You need a Google account to join the pilot.");
});

test("Terms and Privacy open in a sheet and the ticks stay", async ({ page }) => {
  await page.goto("/");
  const adult = page.getByRole("checkbox", { name: "I am 18 or older" });
  await adult.check({ force: true });
  await page.getByRole("button", { name: "Terms", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Terms" });
  await expect(sheet.getByText("These terms are an agreement between you")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Privacy Notice", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Privacy Notice" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(adult).toBeChecked();
});

test("Continue stores the declarations and goes to Google through Supabase", async ({ page }) => {
  // The form post is caught so the browser never leaves for Google; the server's own answer is
  // checked instead: a redirect to Supabase's Google sign-in, with the declarations' cookie.
  let location: URL | undefined;
  let cookies: string[] = [];
  await page.route("**/auth/start", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    location = new URL(response.headers().location ?? "");
    cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    await route.fulfill({ status: 200, contentType: "text/plain", body: "Google sign-in" });
  });
  await page.goto("/?next=%2Fme");
  await page.getByText("I am 18 or older").click();
  await page.getByText("I accept the", { exact: true }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Google sign-in")).toBeVisible();
  expect(location?.pathname).toBe("/auth/v1/authorize");
  expect(location?.searchParams.get("provider")).toBe("google");
  expect(location?.searchParams.get("redirect_to")).toMatch(/\/auth\/callback$/);
  expect(location?.searchParams.get("code_challenge")).toBeTruthy();
  const intent = cookies.find((cookie) => cookie.startsWith("rc_signup_intent="));
  expect(intent).toMatch(/HttpOnly/i);
  expect(cookies.find((cookie) => cookie.startsWith("rc_next="))).toMatch(/^rc_next=%2Fme;/);
});

test("a failed sign-in shows one general message", async ({ page }) => {
  await page.goto("/?error=signin");
  // Inside <main>: Next.js adds its own empty route announcer with the alert role.
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "We couldn't sign you in. Please try again.",
  );
});

test("a page that needs a session sends the visitor to sign in and remembers the way back", async ({
  page,
}) => {
  for (const path of ["/me", "/me/data", "/recordings", "/classes/organize"]) {
    await page.goto(path);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/" && url.searchParams.get("next") === path,
    );
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, viewport] of [
    ["mobile", VIEWPORTS.mobile],
    ["desktop", VIEWPORTS.desktop],
  ] as const) {
    test(`sign-in page has no WCAG 2.2 AA violations: ${scheme}, ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expectNoAxeViolations(page);
    });
  }
}
