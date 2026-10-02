import { z } from "zod";

const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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

function parseEnv<T>(
  schema: z.ZodType<T>,
  env: Record<string, string | undefined>,
  label: string,
): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid ${label} configuration: ${names.join(", ")}`);
  }
  return result.data;
}
