import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const stubs = vi.hoisted(() => ({
  readEnv: vi.fn(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
}));
vi.mock("@recalino/core/config", () => ({ readSupabaseEnv: stubs.readEnv }));
vi.mock("@supabase/ssr", () => ({ createServerClient: stubs.createClient }));
vi.mock("./server/auth/supabase", () => ({ SESSION_COOKIE_OPTIONS: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RECALINO_UI_PREVIEW", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  stubs.readEnv.mockImplementation(() => {
    throw new Error("A fixture must not read Auth configuration.");
  });
  stubs.createClient.mockImplementation(() => {
    throw new Error("A fixture must not construct an Auth client.");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy fixture isolation", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/preview/today"],
    ["GET", "/api/health"],
    ["GET", "/api/jobs/run"],
    ["POST", "/preview/profile"],
    ["POST", "/auth/start"],
  ])("handles %s %s before reading Auth or refreshing a session", async (method, path) => {
    const response = await proxy(
      new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: { cookie: "sb-synthetic-auth-token=test-only" },
      }),
    );
    expect(response.status).toBeLessThan(500);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(stubs.readEnv).not.toHaveBeenCalled();
    expect(stubs.createClient).not.toHaveBeenCalled();
    expect(stubs.getClaims).not.toHaveBeenCalled();
  });

  it.each(["/api/jobs/run", "/api/health", "/preview/profile", "/auth/callback", "/me"])(
    "the compiled matcher protects %s, including API and server-action entry points",
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
    },
  );

  it("normal product requests still refresh Auth when fixture mode is absent", async () => {
    vi.stubEnv("RECALINO_UI_PREVIEW", undefined);
    stubs.readEnv.mockReturnValue({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-unit-test-key",
    });
    stubs.createClient.mockReturnValue({ auth: { getClaims: stubs.getClaims } });
    stubs.getClaims.mockResolvedValue({ data: null });
    const response = await proxy(new NextRequest("http://localhost:3000/today"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(stubs.readEnv).toHaveBeenCalledOnce();
    expect(stubs.getClaims).toHaveBeenCalledOnce();
  });

  it.each([
    ["/icons/icon-192.png", { "next-action": "sample-action" }],
    ["/manifest.webmanifest", { "content-type": "multipart/form-data; boundary=sample" }],
    ["/_next/static/sample.js", { "content-type": "application/x-www-form-urlencoded" }],
  ])("intercepts action entry points on excluded static URLs: %s", async (path, headers) => {
    const request = new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: headers as Record<string, string>,
    });
    expect(unstable_doesMiddlewareMatch({ config, url: path, headers })).toBe(true);
    expect((await proxy(request)).status).toBe(403);
    expect(stubs.readEnv).not.toHaveBeenCalled();
    expect(stubs.createClient).not.toHaveBeenCalled();
  });

  it("preview pages also bypass Auth when viewed beside the normal product", async () => {
    vi.stubEnv("RECALINO_UI_PREVIEW", undefined);
    const response = await proxy(new NextRequest("http://localhost:3000/preview/today"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(stubs.readEnv).not.toHaveBeenCalled();
    expect(stubs.createClient).not.toHaveBeenCalled();
  });
});
