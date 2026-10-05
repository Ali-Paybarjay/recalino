import type { AdminResult, AdminSnapshot, AdminView } from "./contracts";

export class AdminRequestError extends Error {
  constructor(
    readonly code: string,
    readonly reasons: string[] = [],
    readonly requestId?: string,
  ) {
    super(code);
  }
}
async function read<T>(response: Response): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AdminRequestError("internal");
  }
  if (!response.ok) {
    const error = (
      value as {
        error?: {
          code?: string;
          details?: { fields?: Record<string, string[]> };
          request_id?: string;
        };
      }
    ).error;
    throw new AdminRequestError(
      error?.code ?? "internal",
      Object.values(error?.details?.fields ?? {}).flat(),
      error?.request_id,
    );
  }
  return value as T;
}
export function adminQuery(
  view: AdminView,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<AdminSnapshot> {
  const query = new URLSearchParams({ view, ...params });
  return fetch(`/api/admin?${query}`, { cache: "no-store", signal }).then(read<AdminSnapshot>);
}
/** Keep the key for an identical submitted payload even after a network error. */
export function submissionKey(
  holder: { current: Map<string, string> },
  action: string,
  input: unknown,
): string {
  const payload = JSON.stringify({ action, input });
  let key = holder.current.get(payload);
  if (!key) {
    key = crypto.randomUUID();
    holder.current.set(payload, key);
  }
  return key;
}
export function releaseSubmissionKey(
  holder: { current: Map<string, string> },
  action: string,
  input: unknown,
): void {
  holder.current.delete(JSON.stringify({ action, input }));
}
export function adminAction(action: string, input: unknown, key: string): Promise<AdminResult> {
  return fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ action, input }),
  }).then(read<AdminResult>);
}
