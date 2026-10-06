import type { AdminEmail, AdminResult, AdminSnapshot, AdminView } from "./contracts";

export class AdminRequestError extends Error {
  constructor(
    readonly code: string,
    readonly reasons: string[] = [],
    readonly requestId?: string,
    readonly fields: Record<string, string[]> = {},
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
      error?.details?.fields ?? {},
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

export function emailStatusPending(emails: AdminEmail[]): boolean {
  return emails.some((email) => email.state === "queued" || email.state === "sending");
}

/** Reads approved metadata only. This never resubmits an approval or delivery request. */
export async function refreshEmailStatuses(
  emails: AdminEmail[],
  update: (emails: AdminEmail[]) => void,
  signal: AbortSignal,
  refreshInitially = false,
): Promise<void> {
  if (!emails.length || signal.aborted) return;
  const ids = [...new Set(emails.map((email) => email.id))];
  let current = emails;
  let refresh = refreshInitially;
  const deadline = Date.now() + 120_000;
  // Bound background reads to two minutes; the history remains available for later checks.
  for (
    let poll = 0;
    poll < 60 && Date.now() < deadline && (refresh || emailStatusPending(current));
    poll++
  ) {
    if (!refresh) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 2000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
    if (signal.aborted) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const requestController = new AbortController();
    const stopRequest = () => requestController.abort();
    const timeout = setTimeout(stopRequest, Math.min(10_000, remaining));
    signal.addEventListener("abort", stopRequest, { once: true });
    let snapshots: AdminSnapshot[];
    try {
      snapshots = await Promise.all(
        Array.from({ length: Math.ceil(ids.length / 50) }, (_, batch) =>
          adminQuery(
            "history",
            { emailIds: ids.slice(batch * 50, (batch + 1) * 50).join(",") },
            requestController.signal,
          ),
        ),
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", stopRequest);
      // If one batch failed, stop any other batch requests still waiting for a response.
      requestController.abort();
    }
    if (signal.aborted) return;
    const byId = new Map(
      snapshots.flatMap((snapshot) => snapshot.emails ?? []).map((email) => [email.id, email]),
    );
    // A tombstoned account is absent from the live projection and must disappear here too.
    current = ids.flatMap((id) => {
      const email = byId.get(id);
      return email ? [email] : [];
    });
    update(current);
    refresh = false;
  }
}
