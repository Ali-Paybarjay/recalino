import { randomUUID } from "node:crypto";
import { getAccountState } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import { ownsBrowserPushSubscription, saveBrowserPushSubscription } from "@recalino/core/plt";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { signOutHandler } from "../auth/flow";
import { ROUTES } from "../routes";
import { fakeAuth, flowDeps, memoryJar, routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

// FR-PLT-002 / NFR-01 for POST /auth/sign-out: signing out ends only the caller's own session.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });

afterAll(async () => {
  await db.destroy();
});

describe("POST /auth/sign-out across accounts", () => {
  it("revokes only the caller's device recipient before ending the session", async () => {
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    const input = () => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
    });
    const aliceDevice = input(),
      bobDevice = input();
    const ctx = (userId: string) => ({ userId, requestId: randomUUID() });
    await saveBrowserPushSubscription(db, ctx(alice), aliceDevice);
    await saveBrowserPushSubscription(db, ctx(bob), bobDevice);
    const auth = fakeAuth();
    const route = defineRoute(
      ROUTES.authSignOut,
      signOutHandler(flowDeps(auth.gateway, memoryJar())),
      routeDeps(db),
    );
    expect(
      (
        await route(
          requestAs(alice, "/auth/sign-out", "POST", { pushEndpoint: bobDevice.endpoint }),
        )
      ).status,
    ).toBe(303);
    expect(await ownsBrowserPushSubscription(db, ctx(bob), bobDevice.endpoint)).toBe(true);
    expect(
      (
        await route(
          requestAs(alice, "/auth/sign-out", "POST", { pushEndpoint: aliceDevice.endpoint }),
        )
      ).status,
    ).toBe(303);
    expect(await ownsBrowserPushSubscription(db, ctx(alice), aliceDevice.endpoint)).toBe(false);
    expect(await ownsBrowserPushSubscription(db, ctx(bob), bobDevice.endpoint)).toBe(true);
  });
  it("acts on the caller's session cookie only and leaves other accounts as they were", async () => {
    const auth = fakeAuth();
    const route = defineRoute(
      ROUTES.authSignOut,
      signOutHandler(flowDeps(auth.gateway, memoryJar())),
      routeDeps(db),
    );
    const [alice, bob] = await Promise.all([newLearner(db), newLearner(db)]);
    const before = await getAccountState(db, bob);
    const response = await route(requestAs(alice, "/auth/sign-out", "POST"));
    expect(response.status).toBe(303);
    expect(auth.calls.signOut).toBe(1);
    expect(auth.calls.deleted).toEqual([]);
    expect(await getAccountState(db, bob)).toEqual(before);
  });
});
