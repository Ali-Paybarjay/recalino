import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@recalino/core/db";
import { assertOwner, DEFAULT_PLT_SETTINGS, type PltSettings } from "@recalino/core/plt";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { defineRoute, type Handler, type RouteDeps } from "./api";
import type { RouteMeta } from "./routes";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });

afterAll(async () => {
  await db.destroy();
});

const IP_KEY = "test-only-ip-key-0123456789abcdef0123456789";

function deps(settings: PltSettings = DEFAULT_PLT_SETTINGS): Partial<RouteDeps> {
  return {
    database: () => db,
    sessions: {
      getSession: async (request) => {
        const userId = request.headers.get("x-test-user");
        return userId ? { userId } : null;
      },
    },
    settings: () => settings,
    ipKey: () => IP_KEY,
    log: () => {},
  };
}

function send(
  route: (request: Request) => Promise<Response>,
  userId: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return route(
    new Request("http://localhost/api/probe", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-test-user": userId, ...headers },
    }),
  );
}

async function count(
  table: "plt.audit_event" | "plt.security_event",
  column: string,
  value: string,
) {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where(column as never, "=", value as never)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

const createProbe: Handler = async ({ input, ctx, db: tx }) => {
  const { subject } = input as { subject: string };
  await tx
    .insertInto("plt.audit_event")
    .values({
      actor_kind: "learner",
      actor_id: ctx.userId ?? "",
      action: "create_probe",
      subject_type: "probe",
      subject_id: subject,
    })
    .execute();
  return { status: 201, body: { subject } };
};

describe("idempotent routes through the wrapper (FR-PLT-004, AC-13)", () => {
  const meta: RouteMeta = {
    id: "probe_create",
    path: "/api/probe",
    access: "learner",
    idempotency: "required",
  };

  it("creates once and replays the same response", async () => {
    const route = defineRoute(meta, createProbe, deps());
    const user = randomUUID();
    const subject = randomUUID();
    const key = { "Idempotency-Key": `k-${randomUUID()}` };
    const first = await send(route, user, { subject }, key);
    const again = await send(route, user, { subject }, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await count("plt.audit_event", "subject_id", subject)).toBe(1);
  });

  it("answers a changed body under the same key with idempotency_mismatch", async () => {
    const route = defineRoute(meta, createProbe, deps());
    const user = randomUUID();
    const key = { "Idempotency-Key": `k-${randomUUID()}` };
    await send(route, user, { subject: randomUUID() }, key);
    const changed = randomUUID();
    const response = await send(route, user, { subject: changed }, key);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("idempotency_mismatch");
    expect(await count("plt.audit_event", "subject_id", changed)).toBe(0);
  });

  it("applies one effect for concurrent requests with the same key", async () => {
    const route = defineRoute(meta, createProbe, deps());
    const user = randomUUID();
    const subject = randomUUID();
    const key = { "Idempotency-Key": `k-${randomUUID()}` };
    const responses = await Promise.all([1, 2, 3].map(() => send(route, user, { subject }, key)));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await count("plt.audit_event", "subject_id", subject)).toBe(1);
  });
});

describe("rate limiting through the wrapper (FR-PLT-006)", () => {
  const settings: PltSettings = {
    ...DEFAULT_PLT_SETTINGS,
    rateLimits: {
      ...DEFAULT_PLT_SETTINGS.rateLimits,
      export: { limit: 2, windowSeconds: 600, scopes: ["user"] },
      auth: { limit: 1, windowSeconds: 600, scopes: ["ip"] },
    },
    rateLimitRepeatThreshold: 1,
  };

  it("answers over-limit requests with 429 and Retry-After, and records repeats", async () => {
    const meta: RouteMeta = {
      id: "probe_export",
      path: "/api/probe",
      access: "learner",
      rateLimit: "export",
    };
    const route = defineRoute(meta, async () => ({ body: { ok: true } }), deps(settings));
    const user = randomUUID();
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await send(route, user, {});
      statuses.push(response.status);
      if (response.status === 429)
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(await count("plt.security_event", "user_id", user)).toBe(1);
  });

  it("keys IP buckets by a keyed hash, never the raw address", async () => {
    const meta: RouteMeta = {
      id: "probe_auth",
      path: "/api/probe",
      access: "public",
      rateLimit: "auth",
    };
    // A fresh fixture key keeps repeated local runs out of previously consumed buckets.
    // Both requests still share the same key and canonical IP, as they do in production.
    const fixtureIpKey = `${IP_KEY}-${randomUUID()}`;
    const route = defineRoute(meta, async () => ({ body: {} }), {
      ...deps(settings),
      ipKey: () => fixtureIpKey,
    });
    const ip = "203.0.113.42";
    const first = await send(route, "", {}, { "x-forwarded-for": `${ip}, 10.0.0.1` });
    const second = await send(route, "", {}, { "x-forwarded-for": ip });
    expect([first.status, second.status]).toEqual([200, 429]);
    const leaked = await db
      .selectFrom("plt.rate_limit_bucket")
      .select("bucket")
      .where("bucket", "like", `%${ip}%`)
      .execute();
    expect(leaked).toEqual([]);
  });
});

describe("ownership through the wrapper (FR-PLT-002, FR-PLT-007)", () => {
  it("answers another user's resource like a missing one and records the attempt", async () => {
    const meta: RouteMeta = { id: "probe_read", path: "/api/probe", access: "learner" };
    const route = defineRoute(
      meta,
      async ({ ctx }) => {
        assertOwner({ ownerId: randomUUID() }, { userId: ctx.userId ?? "" });
        return { body: {} };
      },
      deps(),
    );
    const missingRoute = defineRoute(
      meta,
      async ({ ctx }) => {
        assertOwner(undefined, { userId: ctx.userId ?? "" });
        return { body: {} };
      },
      deps(),
    );
    const user = randomUUID();
    const denied = await send(route, user, {});
    const missing = await send(missingRoute, randomUUID(), {});
    expect(denied.status).toBe(404);
    const deniedBody = (await denied.json()).error;
    const missingBody = (await missing.json()).error;
    expect({ ...deniedBody, request_id: "x" }).toEqual({ ...missingBody, request_id: "x" });
    expect(await count("plt.security_event", "user_id", user)).toBe(1);
  });
});

export type { Database };
