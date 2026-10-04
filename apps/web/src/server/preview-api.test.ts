import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineRoute, type Handler, type RouteDeps } from "./api";
import type { RouteMeta } from "./routes";

beforeEach(() => {
  vi.stubEnv("RECALINO_UI_PREVIEW", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => vi.unstubAllEnvs());

describe("API handlers cannot escape the fixture boundary", () => {
  it.each(["public", "learner", "system"] as const)(
    "refuses a %s route before validation, session, DB, rate-limit or handler work",
    async (access) => {
      const forbidden = () => {
        throw new Error("Real backend work must not run in fixture mode.");
      };
      const handler = vi.fn<Handler>(async () => forbidden());
      const deps: Partial<RouteDeps> = {
        sessions: { getSession: vi.fn(async () => forbidden()) },
        database: vi.fn(forbidden),
        settings: vi.fn(forbidden),
        ipKey: vi.fn(forbidden),
        cronSecret: vi.fn(forbidden),
        log: vi.fn(),
      };
      const meta: RouteMeta = {
        id: "fixture-probe",
        path: "/api/probe",
        access,
        rateLimit: "auth",
        idempotency: "required",
      };
      const response = await defineRoute(
        meta,
        handler,
        deps,
      )(
        new Request("http://localhost:3000/api/probe", {
          method: "POST",
          body: "{malformed JSON",
          headers: { origin: "https://untrusted.invalid" },
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "preview_only" } });
      expect(handler).not.toHaveBeenCalled();
      expect(deps.sessions?.getSession).not.toHaveBeenCalled();
      expect(deps.database).not.toHaveBeenCalled();
      expect(deps.settings).not.toHaveBeenCalled();
      expect(deps.ipKey).not.toHaveBeenCalled();
      expect(deps.cronSecret).not.toHaveBeenCalled();
      expect(deps.log).not.toHaveBeenCalled();
    },
  );
});
