import { z } from "zod";

// A pasted value can carry a space, line break or invisible character anywhere; any of them makes
// the pooler see another user name (M4-A1). Every character must be visible ASCII.
const VISIBLE_ASCII = /^[\x21-\x7e]*$/;

const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((value) => VISIBLE_ASCII.test(value), {
      message: "only visible ASCII characters: no spaces, line breaks or control characters",
      abort: true,
    })
    .pipe(z.url({ protocol: /^postgres(ql)?$/ })),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * Reads the database settings and fails fast when they are missing or malformed.
 * The error names the variables but never echoes their values, which may hold credentials.
 */
export function readDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  return parseEnv(databaseEnvSchema, env, "database");
}

const rateLimitEnvSchema = z.object({
  // Keys the HMAC that turns client IPs into rate-limit buckets; the raw IP is never stored.
  RATE_LIMIT_IP_KEY: z.string().min(32),
});

export function readRateLimitIpKey(env: Record<string, string | undefined> = process.env): string {
  return parseEnv(rateLimitEnvSchema, env, "rate limit").RATE_LIMIT_IP_KEY;
}

const supabaseEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  // Publishable key: identifies the project to Supabase Auth; used on the server only (M3).
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  // Secret key: server only, for deleting an Auth user left without a Recalino account.
  SUPABASE_SECRET_KEY: z.string().min(20),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

export function readSupabaseEnv(
  env: Record<string, string | undefined> = process.env,
): SupabaseEnv {
  return parseEnv(supabaseEnvSchema, env, "Supabase");
}

const cronEnvSchema = z.object({
  // Vercel Cron sends it as a bearer token; it guards the job runner (FR-PLT-005, M4).
  CRON_SECRET: z.string().min(32),
});

export function readCronSecret(env: Record<string, string | undefined> = process.env): string {
  return parseEnv(cronEnvSchema, env, "cron").CRON_SECRET;
}

function parseEnv<T>(
  schema: z.ZodType<T>,
  env: Record<string, string | undefined>,
  label: string,
): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    const { issues } = result.error;
    const names = [...new Set(issues.map((issue) => issue.path.join(".")))];
    // Only reasons written in this file are shown; they never quote the value.
    const reasons = [
      ...new Set(issues.filter((issue) => issue.code === "custom").map((issue) => issue.message)),
    ];
    const because = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
    const error = new Error(`Invalid ${label} configuration: ${names.join(", ")}${because}`);
    // Request logs keep only the error name, so this tells a configuration fault from a crash.
    error.name = "ConfigurationError";
    throw error;
  }
  return result.data;
}
