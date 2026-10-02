// Client calls for setup and Settings. Same origin, JSON; the session travels in the httpOnly
// cookie, so no token is handled here (FR-PLT-001).
import type { ProfileChange, SetupStep } from "@recalino/core/acc";

export type SavedProfile = { setupStep: SetupStep; setupComplete: boolean };

export class SaveError extends Error {}

async function send(path: string, method: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SaveError("Something went wrong. Please try again.");
  }
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new SaveError(data?.error?.message ?? "Something went wrong. Please try again.");
  }
  return data;
}

export async function saveProfile(change: ProfileChange): Promise<SavedProfile> {
  return (await send("/api/profile", "PATCH", change)) as SavedProfile;
}

export async function acceptTexts(
  acceptances: ReadonlyArray<{ document: string; version: string }>,
): Promise<void> {
  await send("/api/consents", "POST", { acceptances });
}
