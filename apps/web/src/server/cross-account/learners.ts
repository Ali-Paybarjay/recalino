import {
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  getAccountState,
} from "@recalino/core/acc";
import type { Database } from "@recalino/core/db";
import { createAuthUser } from "../../../../../packages/core/test/auth-users";

/** A signed-up learner with an empty profile, as after the sign-in page and Google. */
export async function newLearner(db: Database): Promise<string> {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  return userId;
}

export async function profileOf(db: Database, userId: string) {
  return (await getAccountState(db, userId))?.profile;
}

export function requestAs(
  userId: string | null,
  path: string,
  method: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
  };
  if (userId !== null) headers["x-test-user"] = userId;
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
