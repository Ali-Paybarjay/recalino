import { readSupabaseEnv } from "@recalino/core/config";

/** Pure environment policy shared by the server and its local browser-test launcher. */
export function devUiEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV !== "production" || env.RECALINO_DEV_UI === "1";
}

export function testSignInAvailable(env: Readonly<Record<string, string | undefined>>): boolean {
  if (!devUiEnabled(env)) return false;
  try {
    const host = new URL(readSupabaseEnv(env as Record<string, string | undefined>).SUPABASE_URL)
      .hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

export function localJournalFixtureAvailable(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    env.RECALINO_TEST_JOURNAL === "1" && env.VERCEL_ENV === undefined && testSignInAvailable(env)
  );
}
