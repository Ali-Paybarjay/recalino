import { type AccSettings, DEFAULT_ACC_SETTINGS } from "@recalino/core/acc";
import type { Database } from "@recalino/core/db";
import { DEFAULT_PLT_SETTINGS } from "@recalino/core/plt";
import type { RouteDeps } from "./api";
import type { CookieJar, FlowDeps } from "./auth/flow";
import type { AuthGateway } from "./auth/gateway";

// Shared helpers for the web integration tests: no Next.js request scope, no Google.

export const TEST_IP_KEY = "test-only-ip-key-0123456789abcdef0123456789";

/** Route dependencies with a session taken from the x-test-user header. */
export function routeDeps(db: Database): Partial<RouteDeps> {
  return {
    database: () => db,
    sessions: {
      getSession: async (request) => {
        const userId = request.headers.get("x-test-user");
        return userId ? { userId } : null;
      },
    },
    settings: () => DEFAULT_PLT_SETTINGS,
    ipKey: () => TEST_IP_KEY,
    log: () => {},
  };
}

export function memoryJar(): CookieJar & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (name) => values.get(name),
    set: (name, value) => {
      values.set(name, value);
    },
    delete: (name) => {
      values.delete(name);
    },
  };
}

/** A stand-in for Google through Supabase: each code maps to one Auth user. */
export function fakeAuth(codes: Map<string, string> = new Map()) {
  const calls = { signOut: 0, deleted: [] as string[] };
  const gateway: AuthGateway = {
    googleSignInUrl: async (callback) =>
      `http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callback)}`,
    exchangeCode: async (code) => {
      const id = codes.get(code);
      return id === undefined ? null : { id };
    },
    currentUser: async () => null,
    signOut: async () => {
      calls.signOut += 1;
    },
    deleteUser: async (id) => {
      calls.deleted.push(id);
    },
  };
  return { gateway, calls, codes };
}

export function flowDeps(
  gateway: AuthGateway,
  jar: CookieJar,
  settings: AccSettings = DEFAULT_ACC_SETTINGS,
): FlowDeps {
  return { auth: gateway, jar: async () => jar, settings: () => settings, now: () => new Date() };
}
