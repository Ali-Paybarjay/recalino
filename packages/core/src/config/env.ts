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
  const result = databaseEnvSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid database configuration: ${names.join(", ")}`);
  }
  return result.data;
}
