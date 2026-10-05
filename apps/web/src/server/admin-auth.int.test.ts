import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { createEmailDraft } from "@recalino/core/support";
import { sql } from "kysely";
import { after } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { adminOperation } from "./admin-operation";
import { adminHandler } from "./admin-routes";
import { defineRoute, type Handler, type SessionProvider } from "./api";
import { adminSessions } from "./auth/admin";
import { newLearner, requestAs } from "./cross-account/learners";
import { ROUTES } from "./routes";
import { fakeAuth, routeDeps } from "./test-support";

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  // Approval integration tests never invoke an external dispatcher.
  after: vi.fn(),
}));

const db = createDatabase(testDatabaseUrl());
const provision = createDatabase(LOCAL_ADMIN_DATABASE_URL);
let owner: string, learner: string;
let previous: { user_id: string; enabled: boolean; created_at: Date } | undefined;
const sessions: SessionProvider = {
  getSession: async (req) => {
    const userId = req.headers.get("x-test-user");
    return userId ? { userId } : null;
  },
};
const dependencies = { ...routeDeps(db), adminSessions: sessions };
beforeAll(async () => {
  [owner, learner] = await Promise.all([newLearner(db), newLearner(db)]);
  previous = (
    await sql<{
      user_id: string;
      enabled: boolean;
      created_at: Date;
    }>`select user_id,enabled,created_at from plt.admin_owner`.execute(provision)
  ).rows[0];
  await sql`insert into plt.admin_owner(singleton,user_id,enabled) values(true,${owner}::uuid,true) on conflict(singleton) do update set user_id=excluded.user_id,enabled=true`.execute(
    provision,
  );
});
afterAll(async () => {
  if (previous)
    await sql`update plt.admin_owner set user_id=${previous.user_id}::uuid,enabled=${previous.enabled},created_at=${previous.created_at}`.execute(
      provision,
    );
  else await sql`delete from plt.admin_owner where user_id=${owner}::uuid`.execute(provision);
  await Promise.all([db.destroy(), provision.destroy()]);
});
describe("verified single-owner admin boundary (ADM-I01)", () => {
  it("refuses anonymous and nonowners before handler and does not cache their responses", async () => {
    let called = 0;
    const handler: Handler = async () => {
      called++;
      return { body: { ok: true } };
    };
    const route = defineRoute(ROUTES.admin, handler, dependencies);
    for (const [id, status] of [
      [null, 401],
      [learner, 404],
    ] as const) {
      const result = await route(requestAs(id, "/api/admin?view=users", "GET"));
      expect(result.status).toBe(status);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(called).toBe(0);
    expect((await route(requestAs(owner, "/api/admin", "GET"))).status).toBe(200);
    expect(called).toBe(1);
  });
  it("checks live owner revocation and blocks cross-origin mutations", async () => {
    const route = defineRoute(ROUTES.admin, async () => ({ body: { ok: true } }), dependencies);
    const request = requestAs(owner, "/api/admin", "POST", {});
    request.headers.set("origin", "https://other.example.test");
    request.headers.set("sec-fetch-site", "cross-site");
    expect((await route(request)).status).toBe(403);
    await sql`update plt.admin_owner set enabled=false`.execute(provision);
    try {
      expect((await route(requestAs(owner, "/api/admin", "GET"))).status).toBe(404);
    } finally {
      await sql`update plt.admin_owner set enabled=true`.execute(provision);
    }
    await expect(sql`update plt.admin_owner set enabled=false`.execute(db)).rejects.toThrow();
  });
  it("saves actual bilingual preferences with a durable exact-request receipt", async () => {
    const route = defineRoute(ROUTES.admin, adminHandler(), dependencies);
    const request = requestAs(owner, "/api/admin", "POST", {
      action: "settings.save",
      input: { language: "fa", theme: "dark" },
    });
    request.headers.set("idempotency-key", randomUUID());
    expect((await route(request.clone())).status).toBe(200);
    expect((await route(request.clone())).status).toBe(200);
    const result = await route(requestAs(owner, "/api/admin?view=settings", "GET"));
    expect(result.status).toBe(200);
    expect((await result.json()).settings).toMatchObject({ language: "fa", theme: "dark" });
    const changed = requestAs(owner, "/api/admin", "POST", {
      action: "settings.save",
      input: { language: "en", theme: "dark" },
    });
    changed.headers.set("idempotency-key", request.headers.get("idempotency-key") ?? "");
    expect((await route(changed)).status).toBe(422);
  });
  it("caches only approval IDs and resolves email metadata live on replay after account tombstone", async () => {
    const recipientId = await newLearner(db);
    const address = `private-${randomUUID()}@example.test`;
    const subject = `PRIVATE_SUBJECT_${randomUUID()}`;
    const body = `PRIVATE_BODY_${randomUUID()}`;
    const draft = await createEmailDraft(
      db,
      { actorId: owner },
      {
        operationKey: randomUUID(),
        recipients: [{ userId: recipientId, email: address, language: "en" }],
        templateId: null,
        language: "en",
        subject,
        body,
        reason: "Synthetic exact approval receipt privacy verification",
      },
    );
    const operationKey = randomUUID();
    const request = requestAs(owner, "/api/admin", "POST", {
      action: "email.send",
      input: {
        previewId: `${draft.draftId}:${draft.revision}`,
        draftId: draft.draftId,
        revision: draft.revision,
      },
    });
    request.headers.set("idempotency-key", operationKey);
    vi.mocked(after).mockClear();
    const route = defineRoute(ROUTES.admin, adminHandler(), dependencies);
    const initial = await route(request.clone());
    expect(initial.status).toBe(202);
    const approved = await initial.json();
    expect(approved).toMatchObject({
      ok: true,
      emails: [{ email: address, subject, state: "queued" }],
    });
    expect(approved.emails).toHaveLength(1);
    expect(approved.emails[0]).not.toHaveProperty("body");
    expect(JSON.stringify(approved)).not.toContain(body);
    const emailId = approved.emails[0].id;
    const receipt = await db
      .selectFrom("ops.admin_operation")
      .select("result")
      .where("actor_id", "=", owner)
      .where("operation_key", "=", operationKey)
      .executeTakeFirstOrThrow();
    expect(receipt.result).toEqual({ emailIds: [emailId] });
    for (const privateValue of [address, subject, body]) {
      expect(JSON.stringify(receipt)).not.toContain(privateValue);
    }
    const repeated = await route(request.clone());
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toEqual(approved);
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select("id")
        .where("draft_id", "=", draft.draftId)
        .execute(),
    ).toEqual([{ id: emailId }]);
    await db
      .updateTable("support.email_outbox")
      .set({ state: "failed" })
      .where("id", "=", emailId)
      .execute();
    const retry = requestAs(owner, "/api/admin", "POST", {
      action: "email.retry",
      input: { emailId, reason: "Synthetic confirmed-failure retry privacy verification" },
    });
    const retryOperationKey = randomUUID();
    retry.headers.set("idempotency-key", retryOperationKey);
    const retried = await route(retry.clone());
    expect(retried.status).toBe(202);
    const retriedBody = await retried.json();
    expect(retriedBody.emails[0]).not.toHaveProperty("body");
    expect(JSON.stringify(retriedBody)).not.toContain(body);
    const retryReceipt = await db
      .selectFrom("ops.admin_operation")
      .select("result")
      .where("actor_id", "=", owner)
      .where("operation_key", "=", retryOperationKey)
      .executeTakeFirstOrThrow();
    expect(retryReceipt.result).toEqual({ emailIds: [emailId] });
    for (const privateValue of [address, subject, body]) {
      expect(JSON.stringify(retryReceipt)).not.toContain(privateValue);
    }
    const retryReplayed = await route(retry.clone());
    expect(retryReplayed.status).toBe(202);
    expect(await retryReplayed.json()).toEqual(retriedBody);
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select("id")
        .where("draft_id", "=", draft.draftId)
        .execute(),
    ).toEqual([{ id: emailId }]);
    await db
      .updateTable("acc.user_account")
      .set({ deleted_at: new Date() })
      .where("id", "=", recipientId)
      .execute();
    // Pending purge still has its SUPPORT snapshot, but cached approval receipts contain no PII.
    expect(
      await db
        .selectFrom("support.email_outbox")
        .select(["id", "email"])
        .where("draft_id", "=", draft.draftId)
        .execute(),
    ).toEqual([{ id: emailId, email: address }]);
    const deletedReplay = await route(request.clone());
    expect(deletedReplay.status).toBe(202);
    const hidden = await deletedReplay.json();
    expect(hidden).toEqual({ ok: true, emails: [] });
    for (const privateValue of [address, subject, body]) {
      expect(JSON.stringify(hidden)).not.toContain(privateValue);
    }
    expect(
      await db
        .selectFrom("ops.admin_operation")
        .select("result")
        .where("actor_id", "=", owner)
        .where("operation_key", "=", operationKey)
        .executeTakeFirstOrThrow(),
    ).toEqual(receipt);
    expect(vi.mocked(after)).toHaveBeenCalled();
  });
  it("deduplicates concurrent atomic operations and never trusts a request owner claim", async () => {
    const key = randomUUID();
    let called = 0;
    const effect = async () => {
      called++;
      return { ok: true };
    };
    await Promise.all([
      adminOperation(db, owner, key, { value: 1 }, "test.admin", "Synthetic verification", effect),
      adminOperation(db, owner, key, { value: 1 }, "test.admin", "Synthetic verification", effect),
    ]);
    expect(called).toBe(1);
    await expect(
      adminOperation(db, owner, key, { value: 2 }, "test.admin", "Synthetic verification", effect),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    const route = defineRoute(ROUTES.admin, adminHandler(), dependencies);
    const forged = requestAs(owner, "/api/admin", "POST", {
      actorId: learner,
      action: "settings.save",
      input: { language: "en", theme: "light" },
    });
    forged.headers.set("idempotency-key", randomUUID());
    expect((await route(forged)).status).toBe(400);
    const { gateway } = fakeAuth();
    gateway.currentUser = async () => ({ id: owner });
    expect(await adminSessions(gateway).getSession(forged)).toEqual({ userId: owner });
  });
});
