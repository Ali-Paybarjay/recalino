import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("learning preferences persist and resetting suggestions keeps explicit choices", async ({
  page,
}) => {
  test.setTimeout(120000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/me/learning");
  await expect(page.getByText("Estimated support level: Unknown.")).toBeVisible();
  await page.getByLabel("Use shorter examples", { exact: true }).selectOption("yes");
  await expect(page.getByText("Your learning preference is saved.")).toBeVisible();
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/learning/preferences") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Reset suggested preferences" }).click();
  const reset = await resetResponse;
  expect(reset.status(), await reset.text()).toBe(200);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Use shorter examples", { exact: true })).toHaveValue("yes");
  await expectNoAxeViolations(page);
});
test("account deletion requires explicit acknowledgement and hides the account", async ({
  page,
}) => {
  test.setTimeout(120000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/me/data");
  await page.getByRole("button", { name: "Review account deletion" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?", exact: true });
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await expectNoAxeViolations(page);
  await page
    .getByLabel("I understand that account deletion cannot be undone", { exact: true })
    .check();
  await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
  // UX-10: leaving by "/" only led back to this page, so the way out is Sign out.
  await expect(page.getByRole("link", { name: "Return to Recalino" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const response = await page.request.get("/api/classes");
  expect(response.status()).toBe(401);
});

// UX-14: the data page tells where the download is (sentence approved by the owner on 2026-10-19)
// and links to the session list.
test("Your data points to the download of notes and cards", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/me/data");
  await expect(
    page.getByText(
      "To keep a copy first, open a session, choose More session tools, then Download notes and cards.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Choose a session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expectNoAxeViolations(page);
});
test("account deletion waits for capture to stop and removes only its device copies", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/today");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  // The recording bar on Today shows Pause as soon as capture starts, before the recording page
  // opens; going back before that would leave the app.
  // D107: /recordings becomes the session's recording page once the session exists; waiting
  // for it keeps that replace from landing after the Back below.
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  // The recording page has no navigation (UX-02): go back to Today, where the recording continues.
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole("link", { name: "Me", exact: true }).first().click();
  await page.getByRole("link", { name: /Your data/ }).click();
  await expect(page.getByRole("button", { name: "Review account deletion" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop and save before deletion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review account deletion" })).toBeEnabled();
  const otherUser = await page.evaluate(async (owner) => {
    const other = crypto.randomUUID();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("recalino-recordings-v1", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["recordings", "photos"], "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const now = new Date().toISOString();
    tx.objectStore("recordings").put({
      id: crypto.randomUUID(),
      userId: other,
      sessionId: null,
      mimeType: "audio/webm",
      status: "saved",
      createdAt: now,
      updatedAt: now,
      activeMs: 0,
      chunks: 0,
      bytes: 0,
      creationKey: crypto.randomUUID(),
      sourceAssetId: null,
    });
    tx.objectStore("photos").put({
      id: crypto.randomUUID(),
      userId: owner,
      recordingId: crypto.randomUUID(),
      offsetMs: 0,
      captureState: "paused",
      blob: new Blob(["synthetic photo"], { type: "image/jpeg" }),
      createdAt: now,
      sourceAssetId: null,
    });
    await done;
    db.close();
    return other;
  }, userId);
  await page.getByRole("button", { name: "Review account deletion" }).click();
  await page
    .getByLabel("I understand that account deletion cannot be undone", { exact: true })
    .check();
  await page
    .getByRole("dialog", { name: "Delete your account?", exact: true })
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(
    page.getByText(
      "Saved recordings, photos and pending uploads for this account were removed from this browser.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const remaining = await page.evaluate(
    async ({ owner, other }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("recalino-recordings-v1", 3);
        request.onsuccess = () => resolve(request.result);
      });
      async function values(name: string) {
        const tx = db.transaction(name, "readonly");
        return new Promise<{ userId: string }[]>((resolve) => {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
        });
      }
      const [recordings, chunks, photos] = await Promise.all([
        values("recordings"),
        values("chunks"),
        values("photos"),
      ]);
      db.close();
      return {
        own: [...recordings, ...chunks, ...photos].filter((row) => row.userId === owner).length,
        other: recordings.filter((row) => row.userId === other).length,
      };
    },
    { owner: userId, other: otherUser },
  );
  expect(remaining).toEqual({ own: 0, other: 1 });
});

for (const outcome of ["pending", "unknown"] as const) {
  test(`${outcome} deletion outcome keeps device audio until the same request is confirmed`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { userId } = await signInAsNewLearner(page, { setup: "complete" });
    await page.goto("/today");
    await page.getByRole("button", { name: "Record a session", exact: true }).click();
    // As above: wait for the recording page before going back to Today.
    // D107: /recordings becomes the session's recording page once the session exists; waiting
    // for it keeps that replace from landing after the Back below.
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
    await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole("link", { name: "Me", exact: true }).first().click();
    await page.getByRole("link", { name: /Your data/ }).click();
    await page.getByRole("button", { name: "Stop and save before deletion", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review account deletion" })).toBeEnabled();
    const requestId = randomUUID();
    const keys: (string | undefined)[] = [];
    // API integration tests exercise the real tombstone and failed journal. This test drives
    // the resulting response contract through the browser without changing runtime fault flags.
    await page.route("**/api/privacy/account", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1 && outcome === "unknown") return route.abort("failed");
      if (keys.length === 1)
        return route.fulfill({
          status: 500,
          json: {
            error: {
              code: "internal",
              message: "Something went wrong. Please try again.",
              details: {
                deletion: { requestId, kind: "account", state: "acknowledgement_pending" },
              },
            },
          },
        });
      return route.fulfill({
        status: 202,
        json: { id: requestId, state: "pending", requestedAt: new Date().toISOString() },
      });
    });
    async function ownCopies() {
      return page.evaluate(async (owner) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("recalino-recordings-v1", 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const values = await new Promise<{ userId: string }[]>((resolve, reject) => {
          const request = db
            .transaction("recordings", "readonly")
            .objectStore("recordings")
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return values.filter((value) => value.userId === owner).length;
      }, userId);
    }
    const copies = await ownCopies();
    expect(copies).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Review account deletion" }).click();
    await page
      .getByLabel("I understand that account deletion cannot be undone", { exact: true })
      .check();
    await page
      .getByRole("dialog", { name: "Delete your account?", exact: true })
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: outcome === "pending" ? "Finish account deletion" : "Check your deletion request",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        outcome === "pending"
          ? "The deletion receipt still needs to be saved."
          : "We could not confirm whether the server received your deletion request.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account deletion requested" })).toHaveCount(0);
    expect(await ownCopies()).toBe(copies);
    await expectNoAxeViolations(page);
    await page
      .getByRole("button", {
        name: outcome === "pending" ? "Finish deletion" : "Check deletion request",
        exact: true,
      })
      .click();
    await expect(page.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
    await expect(
      page.getByText(
        "Saved recordings, photos and pending uploads for this account were removed from this browser.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(await ownCopies()).toBe(0);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    await page.getByRole("link", { name: "Today", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Recording in progress", exact: true }),
    ).toBeDisabled();
  });
}
