import { z } from "zod";

export type RateLimitClass = "auth" | "upload_url" | "ai_start" | "export";

const rateLimitRuleSchema = z.strictObject({
  limit: z.int().positive(),
  windowSeconds: z.int().positive(),
  scopes: z.array(z.enum(["user", "ip"])).min(1),
});

export const pltSettingsSchema = z.strictObject({
  idempotencyTtlSeconds: z.int().positive(),
  rateLimits: z.strictObject({
    auth: rateLimitRuleSchema,
    upload_url: rateLimitRuleSchema,
    ai_start: rateLimitRuleSchema,
    export: rateLimitRuleSchema,
  }),
  /** Hits beyond the limit in one window before a security event is recorded. */
  rateLimitRepeatThreshold: z.int().positive(),
  /** Local hour at which a new study day starts. */
  studyDayStartHour: z.int().min(0).max(23),
  /** FR-PLT-005 job queue defaults; a job kind may override the first four. */
  jobs: z.strictObject({
    maxAttempts: z.int().min(1).max(20),
    /** Longer than the longest function run, so a live runner never loses its claim. */
    leaseSeconds: z.int().min(1).max(3600),
    retryBaseSeconds: z.int().min(0),
    retryMaxSeconds: z.int().min(0),
    /** Finished jobs are kept this long for inspection, then purged. */
    retentionDays: z.int().positive(),
  }),
});

export type PltSettings = z.infer<typeof pltSettingsSchema>;
export type RateLimitRule = PltSettings["rateLimits"][RateLimitClass];

/**
 * Pilot defaults, approved by the product owner on 2026-10-01 (Q-PLT-2), including the 04:00
 * study-day boundary; the rest of gate G07 is still open. On 2026-10-02 the owner raised `auth`
 * from 10 to 100 per 10 minutes, so a whole class can sign up at once behind one college IP. They
 * live here as configuration, apart from the logic, and a deployment overrides any of them with
 * PLT_SETTINGS_JSON without a code change.
 */
export const DEFAULT_PLT_SETTINGS: PltSettings = {
  idempotencyTtlSeconds: 24 * 60 * 60,
  rateLimits: {
    auth: { limit: 100, windowSeconds: 600, scopes: ["ip"] },
    upload_url: { limit: 60, windowSeconds: 60, scopes: ["user"] },
    ai_start: { limit: 10, windowSeconds: 60, scopes: ["user"] },
    export: { limit: 20, windowSeconds: 3600, scopes: ["user"] },
  },
  rateLimitRepeatThreshold: 5,
  studyDayStartHour: 4,
  // Proposed in M4 (2026-10-02). The lease outlasts the 800-second function limit (ADR-0001).
  jobs: {
    maxAttempts: 5,
    leaseSeconds: 900,
    retryBaseSeconds: 30,
    retryMaxSeconds: 3600,
    retentionDays: 30,
  },
};

export function readPltSettings(
  env: Record<string, string | undefined> = process.env,
): PltSettings {
  const raw = env.PLT_SETTINGS_JSON;
  if (!raw) return DEFAULT_PLT_SETTINGS;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    throw new Error("Invalid PLT_SETTINGS_JSON: not valid JSON");
  }
  const result = pltSettingsSchema.safeParse(deepMerge(DEFAULT_PLT_SETTINGS, overrides));
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid PLT_SETTINGS_JSON: ${names.join(", ")}`);
  }
  return result.data;
}

function deepMerge(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides ?? base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
