import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { checkRateLimit, hitRateLimit } from "./rate-limit";
import { recordAudit, recordSecurityEvent } from "./security";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });

afterAll(async () => {
  await db.destroy();
});

const rule = { limit: 2, windowSeconds: 60, scopes: ["user" as const] };
const now = new Date("2026-10-01T09:00:30Z");

async function securityEvents(requestId: string) {
  return db
    .selectFrom("plt.security_event")
    .selectAll()
    .where("request_id", "=", requestId)
    .execute();
}

describe("FR-PLT-006 rate limiting", () => {
  it("allows up to the limit in a window, then reports how long to wait", async () => {
    const bucket = `test:user:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await hitRateLimit(db, bucket, rule, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[2]?.retryAfterSeconds).toBe(30);
  });

  it("starts counting again in the next window", async () => {
    const bucket = `test:user:${randomUUID()}`;
    for (let i = 0; i < 3; i += 1) await hitRateLimit(db, bucket, rule, now);
    const next = await hitRateLimit(db, bucket, rule, new Date("2026-10-01T09:01:00Z"));
    expect(next).toMatchObject({ allowed: true, hits: 1 });
  });

  it("records one security event when the limit is passed repeatedly", async () => {
    const userId = randomUUID();
    const requestId = randomUUID();
    const check = {
      routeClass: "export" as const,
      rule,
      subject: { userId, ipHash: null },
      repeatThreshold: 2,
      route: "probe",
      requestId,
      now,
    };
    const decisions = [];
    for (let i = 0; i < 6; i += 1) decisions.push(await checkRateLimit(db, check));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, false, false, false, false]);
    const events = await securityEvents(requestId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "rate_limited", user_id: userId, route: "probe" });
  });
});

describe("FR-PLT-007 security and audit events", () => {
  it("stores identifiers only and logs allow-listed fields", async () => {
    const requestId = randomUUID();
    const lines: string[] = [];
    await recordSecurityEvent(
      db,
      { kind: "ownership_denied", userId: randomUUID(), route: "classes", requestId },
      (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })),
    );
    const [event] = await securityEvents(requestId);
    expect(Object.keys(event ?? {}).sort()).toEqual(
      ["id", "kind", "occurred_at", "request_id", "route", "user_id"].sort(),
    );
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "security_event",
      kind: "ownership_denied",
    });
  });

  it("keeps an audit row for a sensitive action", async () => {
    const subjectId = randomUUID();
    await recordAudit(db, {
      actorKind: "learner",
      actorId: randomUUID(),
      action: "delete_session",
      subjectType: "class_session",
      subjectId,
    });
    const row = await db
      .selectFrom("plt.audit_event")
      .selectAll()
      .where("subject_id", "=", subjectId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ actor_kind: "learner", action: "delete_session" });
  });
});
