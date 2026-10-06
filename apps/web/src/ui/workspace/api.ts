import { z } from "zod";

const failureSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .object({
        fields: z.record(z.string(), z.array(z.string())).optional(),
        deletion: z
          .strictObject({
            requestId: z.uuid(),
            kind: z.literal("account"),
            state: z.literal("acknowledgement_pending"),
          })
          .optional(),
      })
      .optional(),
  }),
});

export type PendingDeletion = NonNullable<
  NonNullable<z.infer<typeof failureSchema>["error"]["details"]>["deletion"]
>;
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
    let message = failure.success
      ? failure.data.error.message
      : "The change could not be saved. Try again.";
    if (reasons.includes("already_exists"))
      message = path.startsWith("/api/cards")
        ? "A card with this question and answer already exists."
        : "That name already exists. Choose a different name.";
    if (reasons.includes("publish_notes_first"))
      message = "Publish class notes before preparing cards.";
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
      message = "Move or delete the classes in this group first.";
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
      message = "AI is awaiting operator configuration. Your sources remain saved.";
    if (reasons.includes("provider_outcome_unresolved"))
      message =
        "A provider result is still being checked. Contact the operator before trying again.";
    if (
      reasons.includes("changed_after_estimate") ||
      reasons.includes("changed_after_confirmation") ||
      reasons.includes("new_confirmation_required")
    )
      message =
        "The selected sources have changed. Review the processing estimate and confirm again.";
    if (reasons.includes("source_limit") || reasons.includes("input_too_large"))
      message = "Select fewer sources or smaller ranges before processing.";
    if (reasons.includes("part_integrity_mismatch"))
      message =
        "The uploaded audio part did not match the saved recording. Keep the local original and check the selected audio before trying again.";
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
