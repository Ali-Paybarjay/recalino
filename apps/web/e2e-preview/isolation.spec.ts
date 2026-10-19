import { expect, test } from "./helpers";

test("root and product reads go to synthetic equivalents, without app authentication", async ({
  page,
}) => {
  const request = page.request;
  for (const [path, destination] of [
    ["/", "/preview/today"],
    ["/today", "/preview/today"],
    ["/sessions", "/preview/classes"],
    ["/review", "/preview/review"],
    ["/me", "/preview/profile"],
  ]) {
    const response = await request.get(path ?? "/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location ?? "http://invalid", response.url()).pathname).toBe(
      destination,
    );
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  // D51: the old learner address moves permanently to /sessions before the preview mapping.
  const old = await request.get("/classes", { maxRedirects: 0 });
  expect(old.status()).toBe(308);
  expect(new URL(old.headers().location ?? "http://invalid", old.url()).pathname).toBe("/sessions");
});

test("real Auth, jobs, profile, consent and dev handlers refuse requests", async ({ page }) => {
  const request = page.request;
  for (const [method, path] of [
    ["POST", "/auth/start"],
    ["GET", "/auth/callback?code=synthetic"],
    ["POST", "/auth/sign-out"],
    ["PATCH", "/api/profile"],
    ["POST", "/api/consents"],
    ["GET", "/api/jobs/run"],
    ["POST", "/dev/auth/session"],
    ["GET", "/dev/ui"],
    ["POST", "/preview/profile"],
    ["POST", "/me"],
  ]) {
    const response = await request.fetch(path ?? "/", {
      method,
      maxRedirects: 0,
      data: "{invalid JSON",
    });
    expect(response.status(), `${method} ${path}`).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "preview_only" } });
  }
});

test("excluded static paths cannot accept a mutation or invoke an app action", async ({ page }) => {
  const request = page.request;
  for (const path of [
    "/icons/icon-192.png",
    "/manifest.webmanifest",
    "/_next/static/nonexistent.js",
  ]) {
    const response = await request.post(path, {
      maxRedirects: 0,
      headers: { "Next-Action": "nonexistent-synthetic-action" },
      data: "[]",
    });
    expect(response.status(), path).toBeGreaterThanOrEqual(400);
    expect(response.status(), path).toBeLessThan(500);
  }
});
