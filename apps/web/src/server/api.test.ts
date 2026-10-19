import { errorEnvelopeSchema, errors } from "@recalino/core/plt";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineRoute, type Handler, noSessions, type RouteDeps, type SessionProvider } from "./api";
import type { RouteMeta } from "./routes";

const CANARY = "CANARY-class-text-7f3a";

function testDeps(lines: string[], sessions?: SessionProvider): Partial<RouteDeps> {
  return {
    log: (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })),
    database: () => {
      throw new Error("database must not be used in this test");
    },
    sessions: sessions ?? noSessions,
  };
}

const asUser = (userId: string): SessionProvider => ({ getSession: async () => ({ userId }) });
const publicRoute: RouteMeta = { id: "probe", path: "/api/probe", access: "public" };
const learnerRoute: RouteMeta = { id: "probe", path: "/api/probe", access: "learner" };

function call(meta: RouteMeta, handler: Handler, deps: Partial<RouteDeps>, init?: RequestInit) {
  return defineRoute(meta, handler, deps)(new Request("http://localhost/api/probe", init));
}

describe("route wrapper (FR-PLT-003, FR-PLT-007)", () => {
  it("returns the handler's JSON with a request id and logs one safe line", async () => {
    const lines: string[] = [];
    const response = await call(
      publicRoute,
      async () => ({ body: { status: "ok" } }),
      testDeps(lines),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "request",
      route: "probe",
      status: 200,
    });
  });

  it("rejects a learner route without a session before running the handler", async () => {
    let ran = false;
    const response = await call(
      learnerRoute,
      async () => {
        ran = true;
        return { body: {} };
      },
      testDeps([]),
    );
    expect(ran).toBe(false);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
  });

  it("answers invalid input with validation_failed and field codes, never the input", async () => {
    const response = await call(
      publicRoute,
      async ({ input }) => ({ body: z.object({ title: z.string().max(5) }).parse(input) }),
      testDeps([]),
      { method: "POST", body: JSON.stringify({ title: CANARY }) },
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(JSON.parse(text).error.details).toEqual({ fields: { title: ["too_big"] } });
  });

  it("rejects a malformed JSON body", async () => {
    const response = await call(publicRoute, async () => ({ body: {} }), testDeps([]), {
      method: "POST",
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.details).toEqual({ fields: { body: ["invalid_json"] } });
  });

  it("hides unexpected errors and keeps class text out of every log line", async () => {
    const lines: string[] = [];
    const response = await call(
      publicRoute,
      async () => {
        throw new Error(`failed while saving "${CANARY}"`);
      },
      testDeps(lines),
      { method: "POST", body: JSON.stringify({ transcript: CANARY }) },
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(Object.keys(body.error).sort()).toEqual(["code", "message", "request_id"]);
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain(CANARY);
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["request_failed", "request"]);
  });

  it("logs where an unexpected error was thrown and its provider cause, never its text (OPS-02)", async () => {
    const lines: string[] = [];
    const response = await call(
      publicRoute,
      async () => {
        throw Object.assign(new TypeError(`cannot read "${CANARY}"`), { causeCode: "ECONNRESET" });
      },
      testDeps(lines),
    );
    expect(response.status).toBe(500);
    expect(lines.join("\n")).not.toContain(CANARY);
    const failed = lines
      .map((line) => JSON.parse(line))
      .find((line) => line.event === "request_failed");
    expect(failed).toMatchObject({ error_name: "TypeError", cause_code: "ECONNRESET" });
    expect(failed.error_location).toMatch(/^apps\/web\/src\/server\/api\.test\.ts:\d+:\d+$/);
  });

  it("logs the reason of a server error without sending it to the client", async () => {
    const lines: string[] = [];
    const response = await call(
      publicRoute,
      async () => {
        throw errors.configurationMissing("deletion_journal_key_missing");
      },
      testDeps(lines),
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("deletion_journal_key_missing");
    const failed = lines
      .map((line) => JSON.parse(line))
      .find((line) => line.event === "request_failed");
    expect(failed).toMatchObject({ reason: "deletion_journal_key_missing" });
  });

  it("requires an idempotency key on idempotent routes", async () => {
    const meta: RouteMeta = { ...learnerRoute, idempotency: "required" };
    const handler: Handler = async () => ({ body: {} });
    const missing = await call(meta, handler, testDeps([], asUser("u1")), {
      method: "POST",
      body: "{}",
    });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.details).toEqual({
      fields: { "Idempotency-Key": ["required"] },
    });

    const invalid = await call(meta, handler, testDeps([], asUser("u1")), {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "short" },
    });
    expect((await invalid.json()).error.details).toEqual({
      fields: { "Idempotency-Key": ["invalid"] },
    });
  });
});

describe("Auth response caching (FR-PLT-001)", () => {
  it("prevents shared caching of private data and unauthenticated failures", async () => {
    const handler: Handler = async () => ({ body: { private: "synthetic learner data" } });
    const signedIn = await call(learnerRoute, handler, testDeps([], asUser("u1")));
    const signedOut = await call(learnerRoute, handler, testDeps([]));
    expect(signedIn.status).toBe(200);
    expect(signedOut.status).toBe(401);
    for (const response of [signedIn, signedOut]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("prevents caching Auth success and failure redirects, including public callbacks", async () => {
    const callback: RouteMeta = {
      id: "callback",
      path: "/auth/callback",
      access: "public",
      errorRedirect: "/?error=signin",
    };
    const success = await call(callback, async () => ({ redirect: "/today" }), testDeps([]));
    const failure = await call(
      callback,
      async () => {
        throw new Error("Synthetic callback failure");
      },
      testDeps([]),
    );
    expect(success.headers.get("location")).toBe("http://localhost/today");
    expect(failure.headers.get("location")).toBe("http://localhost/?error=signin");
    for (const response of [success, failure]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

describe("redirect targets (FR-PLT-001, SEC-01)", () => {
  const redirectFrom = (target: string) =>
    call(publicRoute, async () => ({ redirect: target }), testDeps([]));

  it.each(["//evil.example/x", "/\\evil.example", "/..//evil.example"])(
    "keeps the relative target %s on the request's origin",
    async (target) => {
      const response = await redirectFrom(target);
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location") ?? "").origin).toBe("http://localhost");
    },
  );

  it("keeps a same-origin path and an absolute provider URL as given", async () => {
    expect((await redirectFrom("/me?x=1#a")).headers.get("location")).toBe(
      "http://localhost/me?x=1#a",
    );
    expect(
      (await redirectFrom("https://auth.example/authorize?provider=google")).headers.get(
        "location",
      ),
    ).toBe("https://auth.example/authorize?provider=google");
  });
});

describe("system routes (FR-PLT-005)", () => {
  const systemRoute: RouteMeta = { id: "probe", path: "/api/probe", access: "system" };
  const SECRET = "cron-secret-for-tests-0123456789abcdef";

  it("run only with the cron secret as a bearer token", async () => {
    const ran: string[] = [];
    const handler: Handler = async () => {
      ran.push("ran");
      return { body: { ok: true } };
    };
    const deps = { ...testDeps([]), cronSecret: () => SECRET };
    const missing = await call(systemRoute, handler, deps);
    const wrong = await call(systemRoute, handler, deps, {
      headers: { authorization: `Bearer ${SECRET}x` },
    });
    const right = await call(systemRoute, handler, deps, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect([missing.status, wrong.status, right.status]).toEqual([401, 401, 200]);
    expect(ran).toEqual(["ran"]);
  });
});
