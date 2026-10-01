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
