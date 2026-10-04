import { randomUUID } from "node:crypto";
import { getAccountState } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../../../../packages/core/test/auth-users";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { fakeAuth, flowDeps, memoryJar, routeDeps } from "../test-support";
import { callbackHandler, INTENT_COOKIE, NEXT_COOKIE, signOutHandler, startHandler } from "./flow";

// FR-ACC-001, FR-ACC-002 and FR-PLT-001 through the real route wrapper, with a fake Google.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });

afterAll(async () => {
  await db.destroy();
});

const ORIGIN = "http://localhost:3000";

function setup() {
  const auth = fakeAuth();
  const jar = memoryJar();
  const deps = flowDeps(auth.gateway, jar);
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  return {
    auth,
    jar,
    start: (form: Record<string, string>, headers: Record<string, string> = {}) =>
      defineRoute(
        ROUTES.authStart,
        startHandler(deps),
        routeDeps(db),
      )(
        new Request(`${ORIGIN}/auth/start`, {
          method: "POST",
          body: new URLSearchParams(form).toString(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site": "same-origin",
            "x-real-ip": ip,
            ...headers,
          },
        }),
      ),
    callback: (query: string) =>
      defineRoute(
        ROUTES.authCallback,
        callbackHandler(deps),
        routeDeps(db),
      )(new Request(`${ORIGIN}/auth/callback?${query}`)),
  };
}

async function securityEvents(kind: string, route: string) {
  const row = await db
    .selectFrom("plt.security_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("kind", "=", kind)
    .where("route", "=", route)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

describe("sign-in page post (FR-ACC-001)", () => {
  it("needs both boxes: otherwise back to the page, with nothing stored", async () => {
    const flow = setup();
    const response = await flow.start({ adult: "on" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(flow.jar.values.has(INTENT_COOKIE)).toBe(false);
  });

  it("stores the declarations and sends the browser to Google", async () => {
    const flow = setup();
    const response = await flow.start({ adult: "on", terms: "on", next: "/me" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/auth/v1/authorize?provider=google");
    expect(response.headers.get("location")).toContain(
      encodeURIComponent(`${ORIGIN}/auth/callback`),
    );
    expect(flow.jar.values.get(INTENT_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.jar.values.get(NEXT_COOKIE)).toBe("/me");
  });

  it("refuses a post from another site", async () => {
    const flow = setup();
    const response = await flow.start(
      { adult: "on", terms: "on" },
      { "sec-fetch-site": "cross-site" },
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(flow.jar.values.has(INTENT_COOKIE)).toBe(false);
  });
});

describe("return from Google (FR-ACC-001, FR-ACC-002)", () => {
  it("creates the account from the declarations and opens setup", async () => {
    const flow = setup();
    const userId = await createAuthUser();
    flow.auth.codes.set("good-code", userId);
    await flow.start({ adult: "on", terms: "on" });
    const response = await flow.callback("code=good-code");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/setup`);
    expect((await getAccountState(db, userId))?.setupStep).toBe(1);
    expect(flow.jar.values.has(INTENT_COOKIE)).toBe(false);
  });

  it("without declarations: no account, the Auth user is removed, a general message", async () => {
    const flow = setup();
    const userId = await createAuthUser();
    flow.auth.codes.set("no-intent", userId);
    const response = await flow.callback("code=no-intent");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(await getAccountState(db, userId)).toBeNull();
    expect(flow.auth.calls.signOut).toBe(1);
    expect(flow.auth.calls.deleted).toEqual([userId]);
  });

  it("a forged or replayed code is refused and recorded", async () => {
    const flow = setup();
    const before = await securityEvents("auth_failures", "authCallback");
    const response = await flow.callback(`code=${randomUUID()}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(await securityEvents("auth_failures", "authCallback")).toBe(before + 1);
  });

  it("cancelling at Google is a plain failure, not a security event", async () => {
    const flow = setup();
    const before = await securityEvents("auth_failures", "authCallback");
    const response = await flow.callback("error=access_denied");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(await securityEvents("auth_failures", "authCallback")).toBe(before);
  });

  it("a returning learner goes back where they were, but never to another site", async () => {
    const flow = setup();
    const userId = await createAuthUser();
    flow.auth.codes.set("first", userId);
    await flow.start({ adult: "on", terms: "on" });
    await flow.callback("code=first");

    flow.auth.codes.set("again", userId);
    await flow.start({ adult: "on", terms: "on", next: "/me" });
    expect((await flow.callback("code=again")).headers.get("location")).toBe(`${ORIGIN}/me`);

    flow.auth.codes.set("evil", userId);
    await flow.start({ adult: "on", terms: "on", next: "https://evil.example/" });
    expect((await flow.callback("code=evil")).headers.get("location")).toBe(`${ORIGIN}/today`);
  });
});

describe("sign out (FR-ACC-002)", () => {
  it("keeps a genuine sign-out failure visible in Settings instead of implying success", async () => {
    const auth = fakeAuth();
    const failedGateway = {
      ...auth.gateway,
      signOut: async () => {
        throw new Error("Synthetic provider failure");
      },
    };
    const route = defineRoute(
      ROUTES.authSignOut,
      signOutHandler(flowDeps(failedGateway, memoryJar())),
      routeDeps(db),
    );
    const userId = await createAuthUser();
    const response = await route(
      new Request(`${ORIGIN}/auth/sign-out`, {
        method: "POST",
        headers: { "x-test-user": userId, "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/me?error=signout`);
  });
  it("ends the session and goes to the start page; without a session it just goes there", async () => {
    const auth = fakeAuth();
    const route = defineRoute(
      ROUTES.authSignOut,
      signOutHandler(flowDeps(auth.gateway, memoryJar())),
      routeDeps(db),
    );
    const userId = await createAuthUser();
    const signedIn = await route(
      new Request(`${ORIGIN}/auth/sign-out`, {
        method: "POST",
        headers: { "x-test-user": userId, "sec-fetch-site": "same-origin" },
      }),
    );
    expect(signedIn.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(auth.calls.signOut).toBe(1);
    const anonymous = await route(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST" }));
    expect(anonymous.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(auth.calls.signOut).toBe(1);
  });
});
