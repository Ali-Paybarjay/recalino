import type { CookieMethodsServer } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";
import { authStep, SESSION_COOKIE_OPTIONS } from "./server/auth/supabase";

const stubs = vi.hoisted(() => ({
  readEnv: vi.fn(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
}));
vi.mock("@recalino/core/config", () => ({ readSupabaseEnv: stubs.readEnv }));
vi.mock("@supabase/ssr", () => ({ createServerClient: stubs.createClient }));
vi.mock("./server/auth/supabase", async (original) => {
  const actual = await original<typeof import("./server/auth/supabase")>();
  return { ...actual, authStep: vi.fn(actual.authStep) };
});

const CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};
let cookieMethods: CookieMethodsServer;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RECALINO_UI_PREVIEW", undefined);
  stubs.readEnv.mockReturnValue({
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-unit-test-key",
  });
  stubs.createClient.mockImplementation((_url, _key, options) => {
    cookieMethods = options.cookies;
    return { auth: { getClaims: stubs.getClaims } };
  });
  stubs.getClaims.mockResolvedValue({ data: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Supabase session refresh (FR-PLT-001)", () => {
  it("refreshes within one bounded Auth step, so a stalled Auth server cannot hold pages (PERF-03)", async () => {
    await proxy(new NextRequest("http://localhost:3000/today"));
    const step = vi.mocked(authStep).mock.results.at(-1)?.value;
    expect(stubs.createClient.mock.calls.at(-1)?.[2]).toMatchObject({
      global: { fetch: step.fetch },
    });
  });

  it("keeps cookies written before the step deadline and drops later writes (PERF-03)", async () => {
    const controller = new AbortController();
    const actual =
      await vi.importActual<typeof import("./server/auth/supabase")>("./server/auth/supabase");
    vi.mocked(authStep).mockImplementationOnce(() => ({
      signal: controller.signal,
      fetch: authStep().fetch,
      run: (work) => actual.withAuthDeadline(work, controller.signal),
    }));
    stubs.getClaims.mockImplementation(async () => {
      await cookieMethods.setAll?.(
        [{ name: "sb-test-auth-token", value: "refreshed", options: {} }],
        CACHE_HEADERS,
      );
      controller.abort();
      await cookieMethods.setAll?.(
        [{ name: "sb-test-auth-token", value: "late", options: {} }],
        {},
      );
      return new Promise(() => {});
    });

    const response = await proxy(new NextRequest("http://localhost:3000/today"));
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toBe(CACHE_HEADERS["Cache-Control"]);
  });
  it("passes refreshed cookies to the page and browser with the Auth cache headers", async () => {
    const request = new NextRequest("http://localhost:3000/today", {
      headers: { cookie: "sb-test-auth-token=expired" },
    });
    stubs.getClaims.mockImplementation(async () => {
      await cookieMethods.setAll?.(
        [{ name: "sb-test-auth-token", value: "refreshed", options: { httpOnly: false } }],
        CACHE_HEADERS,
      );
      return { data: null };
    });

    const response = await proxy(request);
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-test-auth-token=refreshed",
    );
    expect(response.cookies.get("sb-test-auth-token")).toMatchObject({
      value: "refreshed",
      ...SESSION_COOKIE_OPTIONS,
    });
    for (const [name, value] of Object.entries(CACHE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("retains earlier cookie writes and cache headers when Supabase writes again", async () => {
    const request = new NextRequest("http://localhost:3000/today");
    stubs.getClaims.mockImplementation(async () => {
      await cookieMethods.setAll?.(
        [
          { name: "sb-test-auth-token.0", value: "first-chunk", options: {} },
          { name: "sb-test-stale", value: "", options: { maxAge: 0 } },
        ],
        CACHE_HEADERS,
      );
      await cookieMethods.setAll?.(
        [{ name: "sb-test-auth-token.1", value: "second-chunk", options: {} }],
        {},
      );
      return { data: null };
    });

    const response = await proxy(request);
    expect(response.cookies.get("sb-test-auth-token.0")?.value).toBe("first-chunk");
    expect(response.cookies.get("sb-test-auth-token.1")?.value).toBe("second-chunk");
    expect(response.cookies.get("sb-test-stale")?.maxAge).toBe(0);
    const forwarded = response.headers.get("x-middleware-request-cookie");
    expect(forwarded).toContain("sb-test-auth-token.0=first-chunk");
    expect(forwarded).toContain("sb-test-auth-token.1=second-chunk");
    for (const [name, value] of Object.entries(CACHE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it.each(["/today", "/api/profile", "/auth/start", "/auth/callback"])(
    "prevents caching %s even when no session cookie is refreshed",
    async (path) => {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
});
