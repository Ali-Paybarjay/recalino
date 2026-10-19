// OPS-02/OPS-05 (audit 2026-10-18): /api/health stays a public liveness answer; ?deep=1 is a
// readiness check behind the cron token that answers 503 when the database is unusable.
import type { Database } from "@recalino/core/db";
import type { SchemaCheck, SchemaGuard } from "@recalino/core/plt";
import { describe, expect, it } from "vitest";
import { defineRoute, noSessions } from "./api";
import { type HealthDeps, healthHandler } from "./health";
import { ROUTES } from "./routes";

const SECRET = "cron-secret-for-tests-0123456789abcdef";
const fakeDb = {} as Database;

function guard(state: SchemaCheck["state"]): SchemaGuard {
  const check = async (): Promise<SchemaCheck> => ({
    state,
    expected: "20261015120000",
    applied: state === "unknown" ? null : "20261015120000",
  });
  return { check, allowsWork: async () => state !== "behind" };
}

function call(
  path: string,
  options: { token?: string; health?: Partial<HealthDeps>; database?: () => Database } = {},
) {
  const lines: string[] = [];
  const route = defineRoute(
    ROUTES.health,
    healthHandler({
      cronSecret: () => SECRET,
      schema: guard("current"),
      ping: async () => {},
      log: (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })),
      ...options.health,
    }),
    {
      sessions: noSessions,
      log: (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })),
      database:
        options.database ??
        (() => {
          throw new Error("database must not be used");
        }),
    },
  );
  const headers: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {};
  return { response: route(new Request(`http://localhost${path}`, { headers })), lines };
}

describe("GET /api/health", () => {
  it("answers the same public liveness body without touching the database", async () => {
    const { response } = call("/api/health");
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "ok" });
  });

  it("requires the cron token for the deep check", async () => {
    expect((await call("/api/health?deep=1").response).status).toBe(401);
    expect((await call("/api/health?deep=1", { token: "wrong" }).response).status).toBe(401);
  });

  it("reports a reachable, current database", async () => {
    const result = await call("/api/health?deep=1", { token: SECRET, database: () => fakeDb })
      .response;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "ok", database: "ok", schema: "current" });
  });

  it("answers 503 when the database cannot be reached, logging no error text", async () => {
    const { response, lines } = call("/api/health?deep=1", {
      token: SECRET,
      database: () => fakeDb,
      health: {
        ping: async () => {
          throw new Error("connect ECONNREFUSED CANARY-host-secret");
        },
      },
    });
    const result = await response;
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ status: "unavailable", database: "unavailable" });
    expect(lines.join("\n")).not.toContain("CANARY");
    expect(lines.some((line) => line.includes("health_database_unavailable"))).toBe(true);
  });

  it("answers 503 when the database configuration is missing", async () => {
    const result = await call("/api/health?deep=1", { token: SECRET }).response;
    expect(result.status).toBe(503);
  });

  it("answers 503 when the database lacks a migration this code needs", async () => {
    const result = await call("/api/health?deep=1", {
      token: SECRET,
      database: () => fakeDb,
      health: { schema: guard("behind") },
    }).response;
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      status: "unavailable",
      database: "ok",
      schema: "behind",
    });
  });

  it.each(["ahead", "unknown"] as const)("stays ready with a %s schema", async (state) => {
    const result = await call("/api/health?deep=1", {
      token: SECRET,
      database: () => fakeDb,
      health: { schema: guard(state) },
    }).response;
    expect(result.status).toBe(200);
  });
});
