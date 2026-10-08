import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readCronSecret, readRateLimitIpKey } from "@recalino/core/config";
import type { Database } from "@recalino/core/db";
import {
  AppError,
  canonicalJson,
  checkRateLimit,
  createLogger,
  errors,
  hmacSha256Hex,
  isValidIdempotencyKey,
  type Logger,
  type PltSettings,
  readPltSettings,
  recordSecurityEvent,
  runIdempotent,
  sha256Hex,
  toErrorResponse,
} from "@recalino/core/plt";
import { adminSessions, assertAdmin } from "./auth/admin";
import { authSessions } from "./auth/learner";
import { getDatabase } from "./db";
import { previewApiResponse } from "./preview-mode";
import type { RouteMeta } from "./routes";
import type { SessionProvider } from "./session";

export { noSessions, type Session, type SessionProvider } from "./session";

export interface RequestContext {
  requestId: string;
  route: string;
  userId: string | null;
}

export interface HandlerArgs {
  request: Request;
  /** Parsed JSON or form body; handlers validate it with zod. */
  input: unknown;
  ctx: RequestContext;
  /** The idempotency transaction on idempotent routes, otherwise the shared pool. */
  db: Database;
}

export interface ApiResult {
  status?: number;
  body?: unknown;
  /** A path in the app to send the browser to (303), for form posts and the sign-in flow. */
  redirect?: string;
}

export type Handler = (args: HandlerArgs) => Promise<ApiResult>;

export interface RouteDeps {
  sessions: SessionProvider;
  adminSessions?: SessionProvider;
  database: () => Database;
  log: Logger;
  settings: () => PltSettings;
  ipKey: () => string;
  /** CRON_SECRET, the bearer token of "system" routes. */
  cronSecret: () => string;
  now: () => Date;
}

function once<T>(read: () => T): () => T {
  let value: { current: T } | undefined;
  return () => {
    value ??= { current: read() };
    return value.current;
  };
}

const defaultDeps: RouteDeps = {
  sessions: authSessions(),
  adminSessions: adminSessions(),
  database: getDatabase,
  log: createLogger(),
  settings: once(() => readPltSettings()),
  ipKey: once(() => readRateLimitIpKey()),
  cronSecret: once(() => readCronSecret()),
  now: () => new Date(),
};

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Wraps a route handler with the platform rules: request id, session check, rate limit,
 * idempotency, the standard error envelope (FR-PLT-003) and one allow-listed log line per request
 * (FR-PLT-007).
 */
export function defineRoute(
  meta: RouteMeta,
  handler: Handler,
  overrides: Partial<RouteDeps> = {},
): (request: Request) => Promise<Response> {
  const deps: RouteDeps = { ...defaultDeps, ...overrides };

  return async (request) => {
    const preview = previewApiResponse(request);
    if (preview) return preview;
    const requestId = randomUUID();
    const started = performance.now();
    let userId: string | null = null;
    let status = 500;
    let code: string | undefined;
    let response: Response;

    try {
      if (BODY_METHODS.has(request.method)) assertSameOrigin(request);
      // Public routes never need the learner, so they skip the round trip to Auth.
      if (meta.access === "learner") {
        userId = (await deps.sessions.getSession(request))?.userId ?? null;
        if (userId === null) throw errors.unauthenticated();
      }
      if (meta.access === "admin") {
        userId = (await (deps.adminSessions ?? deps.sessions).getSession(request))?.userId ?? null;
        await assertAdmin(deps.database(), userId);
      }
      if (meta.access === "system") assertSystemCaller(request, deps.cronSecret());
      const ctx: RequestContext = { requestId, route: meta.id, userId };

      if (meta.rateLimit) await enforceRateLimit(meta.rateLimit, request, ctx, deps);

      const input = BODY_METHODS.has(request.method) ? await readBody(request) : undefined;
      const result = await run(meta, handler, { request, input, ctx }, deps);

      if (result.redirect !== undefined) {
        status = 303;
        response = redirectTo(result.redirect, request, requestId);
      } else {
        status = result.status;
        const headers: Record<string, string> = { "x-request-id": requestId };
        if (result.replayed) headers["idempotent-replayed"] = "true";
        response = Response.json(result.body ?? null, { status, headers });
      }
    } catch (error) {
      const failure = toErrorResponse(error, requestId);
      status = failure.status;
      code = failure.code;
      if (error instanceof AppError && error.securitySignal) {
        await recordSignal(error.securitySignal, { requestId, route: meta.id, userId }, deps);
      }
      if (failure.code === "internal") {
        deps.log("error", "request_failed", {
          request_id: requestId,
          route: meta.id,
          error_name: error instanceof Error ? error.name : typeof error,
          pg_code: postgresCode(error),
        });
      }
      const errorRedirect =
        failure.code === "unauthenticated" && meta.unauthenticatedRedirect !== undefined
          ? meta.unauthenticatedRedirect
          : meta.errorRedirect;
      if (errorRedirect !== undefined) {
        // Form posts and the sign-in flow show the failure on a page, not as JSON.
        status = 303;
        response = redirectTo(errorRedirect, request, requestId);
      } else {
        response = Response.json(failure.body, {
          status,
          headers: { ...failure.headers, "x-request-id": requestId },
        });
      }
    }

    // Includes error responses and redirects, so a cached 401 cannot outlive sign-in and a
    // callback's new session cookies cannot be replayed to another visitor (FR-PLT-001).
    if (meta.access === "learner" || meta.access === "admin" || meta.path.startsWith("/auth/")) {
      response.headers.set("cache-control", "private, no-store");
    }

    deps.log(status >= 500 ? "error" : "info", "request", {
      request_id: requestId,
      route: meta.id,
      method: request.method,
      status,
      duration_ms: Math.round(performance.now() - started),
      user_id: userId,
      code,
    });
    return response;
  };
}

async function run(
  meta: RouteMeta,
  handler: Handler,
  args: Omit<HandlerArgs, "db">,
  deps: RouteDeps,
): Promise<{ status: number; body: unknown; redirect?: string; replayed?: boolean }> {
  if (meta.idempotency === "handler") {
    const key = args.request.headers.get("idempotency-key");
    if (key === null || !isValidIdempotencyKey(key)) {
      throw errors.validationFailed({ "Idempotency-Key": [key === null ? "required" : "invalid"] });
    }
  }
  if (meta.idempotency !== "required") {
    const result = await handler({
      ...args,
      get db() {
        return deps.database();
      },
    });
    return { status: result.status ?? 200, body: result.body, redirect: result.redirect };
  }

  const userId = args.ctx.userId;
  if (userId === null) throw errors.unauthenticated();
  const key = args.request.headers.get("idempotency-key");
  if (key === null || !isValidIdempotencyKey(key)) {
    throw errors.validationFailed({ "Idempotency-Key": [key === null ? "required" : "invalid"] });
  }
  const requestHash = sha256Hex(
    `${args.request.method} ${meta.id}\n${canonicalJson(args.input ?? null)}`,
  );
  return runIdempotent(
    deps.database(),
    {
      userId,
      key,
      route: meta.id,
      requestHash,
      ttlSeconds: deps.settings().idempotencyTtlSeconds,
      now: deps.now(),
    },
    async (tx) => {
      const result = await handler({ ...args, db: tx });
      return { status: result.status ?? 200, body: result.body };
    },
  );
}

async function enforceRateLimit(
  routeClass: NonNullable<RouteMeta["rateLimit"]>,
  request: Request,
  ctx: RequestContext,
  deps: RouteDeps,
): Promise<void> {
  const settings = deps.settings();
  const rule = settings.rateLimits[routeClass];
  const ip = rule.scopes.includes("ip") ? clientIp(request) : null;
  const decision = await checkRateLimit(deps.database(), {
    routeClass,
    rule,
    subject: { userId: ctx.userId, ipHash: ip ? hmacSha256Hex(deps.ipKey(), ip) : null },
    repeatThreshold: settings.rateLimitRepeatThreshold,
    route: ctx.route,
    requestId: ctx.requestId,
    now: deps.now(),
    log: deps.log,
  });
  if (!decision.allowed) throw errors.rateLimited(decision.retryAfterSeconds);
}

async function recordSignal(
  kind: NonNullable<AppError["securitySignal"]>,
  ctx: RequestContext,
  deps: RouteDeps,
): Promise<void> {
  try {
    await recordSecurityEvent(
      deps.database(),
      { kind, userId: ctx.userId, route: ctx.route, requestId: ctx.requestId },
      deps.log,
    );
  } catch (error) {
    deps.log("error", "security_event_failed", {
      request_id: ctx.requestId,
      route: ctx.route,
      error_name: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; compared in constant time. */
function assertSystemCaller(request: Request, secret: string): void {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const given = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) throw errors.unauthenticated();
}

/**
 * Cookie sessions make cross-site form posts dangerous: a state-changing request must come from
 * this app. Browsers send Sec-Fetch-Site or Origin; clients that send neither (tests, curl)
 * carry no browser cookies to abuse.
 */
function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site === "same-origin" || site === "none") return;
    throw errors.crossSite();
  }
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host === host) return;
  } catch {
    // An unreadable Origin is treated as foreign.
  }
  throw errors.crossSite();
}

function redirectTo(path: string, request: Request, requestId: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: new URL(path, request.url).toString(), "x-request-id": requestId },
  });
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }
  return readJson(request);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw errors.validationFailed({ body: ["invalid_json"] });
  }
}

/** Vercel sets x-real-ip and x-forwarded-for; client-supplied values are overwritten there. */
function clientIp(request: Request): string | null {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { code: unknown }).code;
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : undefined;
}
