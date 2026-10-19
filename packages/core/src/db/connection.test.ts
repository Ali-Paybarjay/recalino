import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionConfig, createDatabase, databaseTls } from "./index";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

const CLOUD =
  "postgresql://recalino_app.ref:do-not-log-me@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres";
const VERIFIED = { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "no error";
}

// PRD-SEC-04 (TLS) has no FR of its own yet; a refused configuration stops with a clear error that
// names the variable only, as FR-PLT-009 asks for a missing key.
describe("PRD-SEC-04 database TLS (FR-PLT-009 configuration errors)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the cloud pooler's certificate against the Supabase root CA only", () => {
    expect(databaseTls(CLOUD, {})).toEqual(VERIFIED);
    expect(databaseTls(CLOUD, { VERCEL_ENV: "production" })).toEqual(VERIFIED);
    expect(
      databaseTls(CLOUD.replace("aws-0-eu-west-2.pooler.supabase.com", "db.example.com"), {}),
    ).toEqual(VERIFIED);
  });

  it("keeps the local database plain, as the local Supabase has no TLS", () => {
    for (const host of ["127.0.0.1:54322", "127.0.0.1:54329", "localhost:54322", "[::1]:54322"]) {
      expect(databaseTls(LOCAL.replace("127.0.0.1:54322", host), {})).toBe(false);
    }
    expect(databaseTls(LOCAL, { VERCEL_ENV: "development" })).toBe(false);
  });

  it("treats only exact loopback names and addresses as local", () => {
    for (const host of [
      "127.0.0.1.example.com",
      "localhost.example.com",
      "LOCALHOST",
      "0.0.0.0",
      // Not IPv4 addresses, so DNS would resolve them like any other name.
      "127.999.999.999",
      "127.0.0.256",
      "127.08.0.1",
    ]) {
      expect(databaseTls(LOCAL.replace("127.0.0.1", host), {})).toEqual(VERIFIED);
    }
  });

  it.each([
    ["a leading space", ` ${LOCAL}`, "only visible ASCII"],
    ["a trailing line break", `${LOCAL}\n`, "only visible ASCII"],
    ["a malformed %-escape", LOCAL.replace("postgres", "post%zzgres"), "a malformed %-escape"],
    ["an escaped loopback name", LOCAL.replace("127.0.0.1", "%6Cocalhost"), "%-escapes"],
    ["an escaped socket path", CLOUD.replace("aws-0-", "%2Ftmp"), "%-escapes"],
    ["the socket: scheme", "socket://localhost/var/run/postgresql", "the scheme"],
    ["an http URL", "https://user:do-not-log-me@127.0.0.1/postgres", "the scheme"],
  ])("refuses %s, which node-postgres would read as another host", (_, value, reason) => {
    vi.stubEnv("PGHOST", "db.example.com");
    const message = errorOf(() => databaseTls(value, {}));
    expect(message).toContain(`Invalid database configuration: DATABASE_URL (${reason}`);
    expect(message).not.toContain("do-not-log-me");
  });

  it("names its errors ConfigurationError, which request logs keep", () => {
    try {
      databaseTls(`${CLOUD}?sslmode=disable`, {});
    } catch (error) {
      expect((error as Error).name).toBe("ConfigurationError");
    }
    expect.assertions(1);
  });

  it.each(["production", "preview"])(
    "stops with a clear error for a database without TLS on Vercel %s",
    (environment) => {
      expect(errorOf(() => databaseTls(LOCAL, { VERCEL_ENV: environment }))).toBe(
        "Invalid database configuration: DATABASE_URL (a local database without TLS is not allowed on Vercel)",
      );
    },
  );

  it("createDatabase refuses the same configuration on Vercel before connecting", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => createDatabase(LOCAL)).toThrow(/without TLS is not allowed on Vercel/);
  });

  it.each([
    "sslmode=disable",
    "sslmode=no-verify",
    "sslmode=require",
    "ssl=false",
    "ssl=0",
    "sslrootcert=/tmp/other-ca.crt",
    "uselibpqcompat=true",
    "host=db.example.com",
    "application_name=recalino",
  ])("refuses query parameters, which could override TLS: %s", (parameter) => {
    for (const url of [CLOUD, LOCAL]) {
      const message = errorOf(() => databaseTls(`${url}?${parameter}`, {}));
      expect(message).toBe(
        "Invalid database configuration: DATABASE_URL (query parameters are not allowed; the app sets TLS)",
      );
      expect(message).not.toContain("do-not-log-me");
    }
  });

  it("refuses a value that is not a URL or has no host, without echoing it", () => {
    expect(errorOf(() => databaseTls("do-not-log-me", {}))).toBe(
      "Invalid database configuration: DATABASE_URL",
    );
    expect(errorOf(() => databaseTls("postgresql://user:do-not-log-me@/postgres", {}))).toMatch(
      /^Invalid database configuration: DATABASE_URL( \(a host is required\))?$/,
    );
  });

  it("node-postgres keeps the app's TLS options whatever PGSSLMODE or PGSSLNEGOTIATION say", () => {
    vi.stubEnv("PGSSLMODE", "no-verify");
    vi.stubEnv("PGSSLNEGOTIATION", "direct");
    const cloud = new pg.Client(connectionConfig(CLOUD));
    expect(cloud.ssl).toEqual(VERIFIED);
    const { sslnegotiation } = (
      cloud as unknown as { connectionParameters: { sslnegotiation: string } }
    ).connectionParameters;
    expect(sslnegotiation).toBe("postgres");
    vi.stubEnv("PGSSLMODE", "require");
    expect(new pg.Client(connectionConfig(LOCAL)).ssl).toBe(false);
  });
});

// OPS-03 (audit 2026-10-18, D82, Q-SPEC-1): a Vercel preview never opens the pilot database. A
// preview is built in fixture mode only (RECALINO_UI_PREVIEW=1); without it, any database
// connection stops with an operator error before a pool exists. Production and local runs are
// unaffected.
describe("OPS-03 no pilot database in a Vercel preview (Q-SPEC-1, D82)", () => {
  const REFUSED =
    "Database access is not allowed in a Vercel preview deployment: pilot secrets belong to Production only, and a preview runs in fixture mode (RECALINO_UI_PREVIEW=1)";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["no fixture flag", {}],
    ["an empty flag", { RECALINO_UI_PREVIEW: "" }],
    ["another flag value", { RECALINO_UI_PREVIEW: "true" }],
  ])("refuses the pilot database in a preview with %s", (_, flag) => {
    for (const url of [CLOUD, LOCAL]) {
      let caught: unknown;
      try {
        connectionConfig(url, { VERCEL_ENV: "preview", ...flag });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe("ConfigurationError");
      expect((caught as Error).message).toBe(REFUSED);
      expect((caught as Error).message).not.toContain("do-not-log-me");
    }
  });

  it("createDatabase refuses it before a pool exists", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RECALINO_UI_PREVIEW", undefined);
    const created = vi.spyOn(pg, "Pool");
    expect(() => createDatabase(CLOUD)).toThrow(REFUSED);
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
  });

  it("leaves a fixture-mode preview, production and local development unchanged", () => {
    const fixture = { VERCEL_ENV: "preview", RECALINO_UI_PREVIEW: "1" };
    expect(connectionConfig(CLOUD, fixture).ssl).toEqual(VERIFIED);
    // A local database stays refused on Vercel, as before.
    expect(errorOf(() => connectionConfig(LOCAL, fixture))).toMatch(/without TLS is not allowed/);
    for (const env of [
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "production", RECALINO_UI_PREVIEW: "1" },
      {},
      { VERCEL_ENV: "development" },
    ]) {
      expect(connectionConfig(CLOUD, env).ssl).toEqual(VERIFIED);
    }
    expect(connectionConfig(LOCAL, {}).ssl).toBe(false);
    expect(connectionConfig(LOCAL, { VERCEL_ENV: "development" }).ssl).toBe(false);
  });
});
