import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUiPreview, previewApiResponse, previewResponse } from "./preview-mode";

const origin = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("RECALINO_UI_PREVIEW", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => vi.unstubAllEnvs());

describe("isolated UI preview boundary", () => {
  it.each([undefined, "0", "true"])("requires the explicit fixture flag (%s)", (flag) => {
    vi.stubEnv("RECALINO_UI_PREVIEW", flag);
    expect(isUiPreview()).toBe(false);
    expect(previewResponse(new NextRequest(`${origin}/`))).toBeNull();
    expect(previewApiResponse(new Request(`${origin}/api/profile`))).toBeNull();
  });

  it("cannot replace a production deployment even when the flag is present", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isUiPreview()).toBe(false);
    expect(previewResponse(new NextRequest(`${origin}/`))).toBeNull();
  });

  it.each([
    ["/", "/preview/today"],
    ["/today", "/preview/today"],
    ["/classes", "/preview/classes"],
    ["/sessions", "/preview/classes"],
    ["/review", "/preview/review"],
    ["/me", "/preview/profile"],
  ])("maps %s to an unauthenticated sample page", (path, destination) => {
    const response = previewResponse(new NextRequest(`${origin}${path}`));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(`${origin}${destination}`);
    expect(response?.headers.has("set-cookie")).toBe(false);
  });

  it.each([
    ["POST", "/auth/start"],
    ["GET", "/auth/callback?code=sample"],
    ["POST", "/auth/sign-out"],
    ["PATCH", "/api/profile"],
    ["POST", "/api/consents"],
    ["GET", "/api/jobs/run"],
    ["POST", "/dev/auth/session"],
    ["GET", "/dev/ui"],
    ["POST", "/preview/profile"],
    ["POST", "/me"],
    ["DELETE", "/preview/classes"],
    ["OPTIONS", "/api/profile"],
  ])("refuses %s %s, including page-path server actions", async (method, path) => {
    const response = previewResponse(new NextRequest(`${origin}${path}`, { method }));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: "preview_only" } });
    expect(response?.headers.has("location")).toBe(false);
    expect(response?.headers.has("set-cookie")).toBe(false);
  });

  it.each(["/preview/today", "/preview/profile", "/icons/icon-192.png", "/manifest.webmanifest"])(
    "lets a read of %s reach the fixture or static resource",
    (path) => {
      const response = previewResponse(new NextRequest(`${origin}${path}`));
      expect(response?.headers.get("x-middleware-next")).toBe("1");
      expect(response?.headers.has("set-cookie")).toBe(false);
    },
  );

  it.each(["/previewing", "/me/edit/first-language", "/unknown"])(
    "does not pass unrelated product paths to authenticated rendering: %s",
    (path) => {
      expect(previewResponse(new NextRequest(`${origin}${path}`))?.status).toBe(404);
    },
  );

  it.each(["GET", "HEAD"])("health answers %s without a backend", async (method) => {
    const response = previewApiResponse(new Request(`${origin}/api/health`, { method }));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ status: "ok", mode: "ui-preview" });
  });

  it.each(["GET", "POST", "PATCH", "DELETE"])(
    "the shared API boundary refuses %s before any handler work",
    async (method) => {
      const response = previewApiResponse(new Request(`${origin}/api/jobs/run`, { method }));
      expect(response?.status).toBe(403);
      expect(await response?.json()).toMatchObject({ error: { code: "preview_only" } });
    },
  );
});
