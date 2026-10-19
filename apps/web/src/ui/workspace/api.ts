// PERF-06: the browser bundles zod/mini, which has the same parsing without the method chain.
import { z } from "zod/mini";
import { accountCopy } from "../account-copy";
import { workspaceErrors } from "./error-copy";

const failureSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.optional(
      z.object({
        fields: z.optional(z.record(z.string(), z.array(z.string()))),
        deletion: z.optional(
          z.strictObject({
            requestId: z.uuid(),
            kind: z.enum(["account", "session"]),
            state: z.literal("acknowledgement_pending"),
          }),
        ),
      }),
    ),
  }),
});

export type PendingDeletion = NonNullable<
  NonNullable<z.infer<typeof failureSchema>["error"]["details"]>["deletion"]
>;
const DEFAULT_FAILURE = "The change could not be saved. Try again.";

export class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly deletion?: PendingDeletion,
    readonly status?: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "WorkspaceRequestError";
  }
}

/** Browser keys are retained for the same submitted payload after a network failure. */
export function requestKey(
  holder: { current: { payload: string; key: string } | null },
  value: unknown,
): string {
  const payload = JSON.stringify(value);
  if (holder.current?.payload !== payload) holder.current = { payload, key: crypto.randomUUID() };
  return holder.current.key;
}

export async function workspaceRequest<T>(
  path: string,
  method: string,
  body?: unknown,
  key?: string,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  });
  // A gateway can return HTML or an empty body during an outage. Retain its status
  // so upload recovery can distinguish that from a rejected source or expired run.
  let invalidResponse = false;
  const value: unknown = await response.json().catch(() => {
    invalidResponse = true;
    return null;
  });
  if (!response.ok) {
    const failure = failureSchema.safeParse(value);
    const fields = failure.success ? failure.data.error.details?.fields : undefined;
    const reasons = Object.values(fields ?? {}).flat();
    let message = failure.success ? failure.data.error.message : DEFAULT_FAILURE;
    // A hidden session whose durable deletion receipt is not saved yet; deleting again with the
    // same key finishes it (FR-ORG-007). Text approved by the product owner on 2026-10-09.
    if (failure.success && failure.data.error.details?.deletion?.kind === "session")
      message =
        "It is now hidden from your list, but deleting it is not finished yet. Try deleting it again in a few minutes.";
    if (reasons.includes("already_exists"))
      message = path.startsWith("/api/cards")
        ? "A card with this question and answer already exists."
        : "That name already exists. Choose a different name.";
    if (reasons.includes("publish_notes_first"))
      message = "Publish session notes before preparing cards.";
    if (reasons.includes("confirmation_required"))
      message = "Check this card and confirm its quality before adding it.";
    if (
      reasons.includes("listening_audio_required") ||
      reasons.includes("listening_audio_unavailable")
    )
      message = "Attach ready listening audio, or change this card to show question text.";
    if (reasons.includes("daily_new_limit"))
      message = "You reached today's new-card limit. Review due cards or adjust your pace.";
    if (reasons.includes("sibling_deferred"))
      message = "A related card was already reviewed this study day. This card is saved for later.";
    if (reasons.includes("move_or_delete_classes_first"))
      message = "Move or delete the sessions in this group first.";
    if (reasons.includes("default_course_cannot_be_deleted"))
      message = "Your default course cannot be deleted.";
    if (reasons.includes("invalid_syntax"))
      message = "Cloze cards need {{c1::answer}} syntax. Edit the selected cloze card first.";
    if (reasons.includes("explicit_export_permission_required"))
      message = "Allow the selected media in exports before continuing.";
    if (reasons.includes("listening_audio_export_required"))
      message = "Listening cards need ready audio with export permission.";
    if (reasons.includes("export_limit"))
      message = "This selection is too large. Select fewer items.";
    if (reasons.includes("configuration_unavailable") && path.includes("/exports"))
      message = "Exports are not configured yet.";
    if (fields?.provider?.includes("configuration_unavailable"))
      message = "AI is awaiting operator configuration. Your material remains saved.";
    // UX-05, D89: the learner never reads "provider", and is told not to retry before the operator
    // has checked the result (owner-approved sentence, docs/design/UI_COPY_PENDING.md).
    if (reasons.includes("provider_outcome_unresolved"))
      message = workspaceErrors.outcomeUnresolved;
    if (
      reasons.includes("changed_after_estimate") ||
      reasons.includes("changed_after_confirmation") ||
      reasons.includes("new_confirmation_required")
    )
      message = workspaceErrors.sourcesChanged;
    if (reasons.includes("source_limit") || reasons.includes("input_too_large"))
      message = "Select less material or smaller ranges before processing.";
    if (reasons.includes("part_integrity_mismatch"))
      message =
        "The uploaded audio part did not match the saved recording. Keep the local original and check the selected audio before trying again.";
    if (/^\/api\/classes\/[^/]+\/voice$/.test(path)) {
      if (
        reasons.includes("transcript_required") ||
        fields?.sources?.some((reason) => ["select_at_least_one", "not_verified"].includes(reason))
      )
        message =
          "Select a session recording in Session material and process it before checking session voices.";
      if (reasons.includes("consent_required") || reasons.includes("consent_changed"))
        message = "Enable voice identification in Voice settings, then check the session again.";
      if (
        reasons.includes("explanation_language_missing") ||
        reasons.includes("explanation_language_invalid")
      )
        message =
          "Choose your explanation language in your profile before checking session voices.";
    }
    throw new WorkspaceRequestError(
      message,
      failure.success ? failure.data.error.code : undefined,
      failure.success ? failure.data.error.details?.deletion : undefined,
      response.status,
      fields,
    );
  }
  if (invalidResponse)
    throw new WorkspaceRequestError(
      "The server response was interrupted. Try again.",
      undefined,
      undefined,
      502,
    );
  return value as T;
}

/** Codes whose server message is written for developers, not for a learner (UX-04). */
const TECHNICAL_CODES = new Set(["idempotency_mismatch", "cross_site"]);
/** Wording that only a developer or the network stack uses; it is never shown to a learner. */
const RAW_TEXT =
  /idempoten|\bsame key\b|failed to fetch|load failed|networkerror|network request failed|\bprovider\b|\[object|^\w+Error:/i;
/** What the browser says when a request never reached the server (Chrome, Firefox and Safari). */
const NETWORK_TEXT =
  /fetch|network|load failed|internet|connection|offline|timed out|timeout|disconnected/i;
const RUNTIME_ERRORS = [TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError];

/**
 * Whether a request failed because the device could not reach the server (offline, a dropped
 * connection, a blocked request): `fetch` rejects with a TypeError then, which carries browser
 * words such as "Failed to fetch". A rejection from the server is never a connection failure.
 */
export function isConnectionFailure(failure: unknown): boolean {
  if (failure instanceof WorkspaceRequestError) return false;
  if (failure instanceof DOMException) return failure.name === "NetworkError";
  if (!(failure instanceof TypeError)) return false;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return offline || NETWORK_TEXT.test(failure.message);
}

/**
 * The words a learner reads for a failed request or action (UX-04). Never the exception text:
 * a lost connection gets the connection message, a server rejection its saved or mapped sentence,
 * and anything else the `fallback` of the screen that asked. Errors the app itself wrote for
 * learners (a plain `Error` or one of its own classes) keep their sentence.
 */
export function userMessage(failure: unknown, fallback: string): string {
  if (isConnectionFailure(failure)) return accountCopy.error.connection;
  if (failure instanceof WorkspaceRequestError) {
    if (failure.code && TECHNICAL_CODES.has(failure.code)) return fallback;
    return learnerText(failure.message) ?? fallback;
  }
  if (
    failure instanceof Error &&
    !(failure instanceof DOMException) &&
    !RUNTIME_ERRORS.some((type) => failure instanceof type)
  )
    return learnerText(failure.message) ?? fallback;
  return fallback;
}

function learnerText(message: string): string | null {
  const text = message.trim();
  return text && !RAW_TEXT.test(text) ? text : null;
}
