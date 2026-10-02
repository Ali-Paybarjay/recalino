import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "@recalino/core/acc";
import { readSupabaseEnv } from "@recalino/core/config";
import { errors } from "@recalino/core/plt";
import { z } from "zod";
import type { Handler } from "./api";
import { createAuthAdmin, createAuthClient } from "./auth/supabase";
import { devUiEnabled } from "./dev-ui";

/**
 * Test sign-in for the end-to-end tests, which can't reach Google. It exists only when the dev
 * pages are on and Auth runs on this machine; against any other Auth server it is a 404, so it
 * can never mint a session on the cloud project.
 */
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

const sessionSchema = z.object({
  setup: z.enum(["none", "complete"]).default("none"),
  firstLanguage: z.string().default("fa"),
  /** Pretend the learner accepted older texts, to test asking again (FR-ACC-007, D33). */
  acceptedVersions: z
    .object({ terms: z.string(), privacy: z.string(), "recording-consent": z.string() })
    .partial()
    .default({}),
});

/** POST /dev/auth/session: a fresh learner, signed in through a password only local Auth has. */
export function devSessionHandler(): Handler {
  return async ({ input, db }) => {
    if (!testSignInAvailable(process.env)) throw errors.notFound();
    const options = sessionSchema.parse(input ?? {});
    const versions = { ...CURRENT_VERSIONS, ...options.acceptedVersions };

    const email = `learner-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const created = await createAuthAdmin().createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Test user could not be created");
    const userId = created.data.user.id;

    const now = new Date();
    const intent = await createSignupIntent(db, { versions, ttlSeconds: 60, now });
    await completeSignIn(db, { userId, intentId: intent.id, now });

    if (options.setup === "complete") {
      const ctx = { userId, requestId: randomUUID() };
      for (const change of [
        { field: "first_language", firstLanguage: options.firstLanguage },
        { field: "explanation_language", explanationLanguage: "english" },
        { field: "level_goal", level: null, goal: null },
        { field: "timezone", timezone: "Europe/London" },
      ] as const) {
        await updateProfile(db, ctx, change, { now });
      }
      await acceptDocuments(
        db,
        ctx,
        [{ document: "recording-consent", version: versions["recording-consent"] }],
        { now, versions },
      );
    }

    const signIn = await (await createAuthClient()).auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error("Test sign-in failed");
    return { body: { userId } };
  };
}
