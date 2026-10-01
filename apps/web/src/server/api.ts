import "server-only";
import { randomUUID } from "node:crypto";
import { readRateLimitIpKey } from "@recalino/core/config";
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
import { getDatabase } from "./db";
import type { RouteMeta } from "./routes";

export interface Session {
  userId: string;
}

export interface SessionProvider {
  getSession(request: Request): Promise<Session | null>;
}

/** Until sign-in arrives with the ACC module (M2), nobody has a session (FR-PLT-001). */
export const noSessions: SessionProvider = { getSession: async () => null };

export interface RequestContext {
  requestId: string;
  route: string;
  userId: string | null;
}

export interface HandlerArgs {
  request: Request;
  /** Parsed JSON body; handlers validate it with zod. */
  input: unknown;
  ctx: RequestContext;
  /** The idempotency transaction on idempotent routes, otherwise the shared pool. */
  db: Database;
}

export interface ApiResult {
  status?: number;
  body: unknown;
}

export type Handler = (args: HandlerArgs) => Promise<ApiResult>;

export interface RouteDeps {
  sessions: SessionProvider;
  database: () => Database;
  log: Logger;
  settings: () => PltSettings;
  ipKey: () => string;
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
  sessions: noSessions,
  database: getDatabase,
  log: createLogger(),
  settings: once(() => readPltSettings()),
  ipKey: once(() => readRateLimitIpKey()),
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
    const requestId = randomUUID();
    const started = performance.now();
    let userId: string | null = null;
    let status = 500;
    let code: string | undefined;
    let response: Response;

    try {
      userId = (await deps.sessions.getSession(request))?.userId ?? null;
      if (meta.access === "learner" && userId === null) throw errors.unauthenticated();
      const ctx: RequestContext = { requestId, route: meta.id, userId };

      if (meta.rateLimit) await enforceRateLimit(meta.rateLimit, request, ctx, deps);

      const input = BODY_METHODS.has(request.method) ? await readJson(request) : undefined;
      const result = await run(meta, handler, { request, input, ctx }, deps);

      status = result.status;
      const headers: Record<string, string> = { "x-request-id": requestId };
      if (result.replayed) headers["idempotent-replayed"] = "true";
      response = Response.json(result.body, { status, headers });
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
      response = Response.json(failure.body, {
        status,
        headers: { ...failure.headers, "x-request-id": requestId },
      });
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
): Promise<{ status: number; body: unknown; replayed?: boolean }> {
  if (meta.idempotency !== "required") {
    const result = await handler({
      ...args,
      get db() {
        return deps.database();
      },
    });
    return { status: result.status ?? 200, body: result.body };
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
