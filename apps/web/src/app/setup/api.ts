// Client calls for setup and Settings. Same origin, JSON; the session travels in the httpOnly
// cookie, so no token is handled here (FR-PLT-001).
import type { ProfileChange, SetupStep } from "@recalino/core/acc";
import { accountCopy } from "../../ui/account-copy";

export type SavedProfile = { setupStep: SetupStep; setupComplete: boolean };

export class SaveError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "SaveError";
    this.code = options.code;
    this.status = options.status ?? 0;
  }
}

async function send(path: string, method: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SaveError(accountCopy.error.connection, { code: "network" });
  }
  const data = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    const code = data?.error?.code;
    throw new SaveError(
      response.status === 401 || code === "unauthenticated"
        ? accountCopy.error.session
        : (data?.error?.message ?? accountCopy.error.save),
      { code, status: response.status },
    );
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
