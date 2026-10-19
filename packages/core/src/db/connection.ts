import { isIPv4 } from "node:net";
import { TLSSocket } from "node:tls";
import pg from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

/** node-postgres `ssl` option: off, or on with the server certificate checked against our CA. */
export type DatabaseTls = false | { ca: string; rejectUnauthorized: true };

/** Only these mean "the local Supabase on this machine": no DNS lookup can redirect them. */
function isLoopback(host: string): boolean {
  return host === "localhost" || host === "[::1]" || (isIPv4(host) && host.startsWith("127."));
}

// node-postgres rewrites a value with a space or a malformed %-escape before parsing it, and could
// then see another host than the check below. Such values are refused, as readDatabaseEnv does.
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i;

/**
 * TLS for a database connection (PRD-SEC-04, T10). The app decides it; the connection string can't:
 *
 * - A loopback host is the local Supabase, which has no TLS, so the connection is plain.
 * - Any other host needs TLS. The server certificate must chain to the Supabase root CA and match
 *   the host name, as with sslmode=verify-full. Nothing turns the check off.
 * - In a Vercel production or preview deployment a loopback host is refused, so a connection
 *   without TLS can't start there silently.
 *
 * Query parameters are refused: node-postgres lets `sslmode`, `ssl`, `sslrootcert` or `host` in
 * the URL override the options above. Errors name the variable, never its value.
 */
export function databaseTls(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): DatabaseTls {
  if (!VISIBLE_ASCII.test(connectionString)) {
    throw invalid("only visible ASCII characters: no spaces, line breaks or control characters");
  }
  if (MALFORMED_ESCAPE.test(connectionString)) throw invalid("a malformed %-escape");
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw invalid();
  }
  // Other schemes, such as socket:, make node-postgres ignore the host checked below.
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw invalid("the scheme must be postgresql");
  }
  if (url.search !== "") throw invalid("query parameters are not allowed; the app sets TLS");
  if (url.hostname === "") throw invalid("a host is required");
  // node-postgres decodes the host (%2F even makes it a socket path), so it must have no escapes.
  if (url.hostname.includes("%")) throw invalid("%-escapes are not allowed in the host");
  if (!isLoopback(url.hostname)) {
    return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
  }
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw invalid("a local database without TLS is not allowed on Vercel");
  }
  return false;
}

/** Named like the errors of readDatabaseEnv, so request logs show `error_name: ConfigurationError`. */
function invalid(reason?: string): Error {
  const error = new Error(
    `Invalid database configuration: DATABASE_URL${reason ? ` (${reason})` : ""}`,
  );
  error.name = "ConfigurationError";
  return error;
}

/**
 * OPS-03 (Q-SPEC-1, D82): a Vercel preview deployment never opens the pilot database. Pilot
 * secrets belong to Production only and a preview is built in fixture mode (RECALINO_UI_PREVIEW=1,
 * as tools/deploy-ui-preview.ps1 does), where the proxy answers every route before any secret is
 * read. A preview without that flag is refused here, before a pool exists, even if Vercel still
 * hands it a DATABASE_URL. Production and local development are unaffected.
 */
function assertDatabaseAllowed(env: Record<string, string | undefined>): void {
  if (env.VERCEL_ENV !== "preview" || env.RECALINO_UI_PREVIEW === "1") return;
  const error = new Error(
    "Database access is not allowed in a Vercel preview deployment: pilot secrets belong to Production only, and a preview runs in fixture mode (RECALINO_UI_PREVIEW=1)",
  );
  error.name = "ConfigurationError";
  throw error;
}

/** The settings every pool and client of the app connects with. */
export function connectionConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): pg.ClientConfig {
  assertDatabaseAllowed(env);
  return {
    connectionString,
    ssl: databaseTls(connectionString, env),
    // Set here so the PGSSLNEGOTIATION variable can't change how TLS starts.
    sslnegotiation: "postgres",
  };
}

export interface DatabaseProbe {
  currentUser: string;
  /** Null for a plain connection to the local database. */
  tls: {
    protocol: string | null;
    /** The certificate chains to the Supabase root CA and matches the host name. */
    certificateVerified: boolean;
    serverName: string;
    issuer: string;
  } | null;
  milliseconds: number;
}

/**
 * Connects once with the app's own settings and reports what the connection used. Used by
 * tools/db-url/check.ts; nothing it returns holds the password.
 */
export async function probeDatabase(
  connectionString: string,
  timeoutMs = 20_000,
): Promise<DatabaseProbe> {
  const client = new pg.Client({
    ...connectionConfig(connectionString),
    connectionTimeoutMillis: timeoutMs,
  });
  const started = performance.now();
  try {
    await client.connect();
    const result = await client.query<{ current_user: string }>("select current_user");
    const stream = client.connection.stream;
    const certificate = stream instanceof TLSSocket ? stream.getPeerCertificate() : undefined;
    return {
      currentUser: result.rows[0]?.current_user ?? "",
      tls:
        stream instanceof TLSSocket && certificate
          ? {
              protocol: stream.getProtocol(),
              certificateVerified: stream.authorized,
              serverName: String(certificate.subject?.CN ?? ""),
              issuer: String(certificate.issuer?.CN ?? ""),
            }
          : null,
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    await client.end().catch(() => {});
  }
}
