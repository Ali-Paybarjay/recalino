import type { RecordingController } from "../recording/controller";
import { WorkspaceRequestError } from "./api";

export interface DeletionReceipt {
  id: string;
  state: string;
  requestedAt: string;
}
export class DeletionOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The connection ended before we could confirm your deletion request. Check the same request again.",
    );
    this.name = "DeletionOutcomeUnknownError";
  }
}

/** A failed acknowledgement can still follow a committed account tombstone. */
export async function submitAccountDeletion(
  controller: Pick<
    RecordingController,
    "prepareAccountDeletion" | "completeAccountDeletion" | "releaseAccountDeletion"
  >,
  send: () => Promise<DeletionReceipt>,
  alreadyHidden = false,
): Promise<DeletionReceipt> {
  let accepted = false;
  let hidden = alreadyHidden;
  let sent = false;
  try {
    await controller.prepareAccountDeletion();
    sent = true;
    const result = await send();
    accepted = true;
    controller.completeAccountDeletion();
    return result;
  } catch (failure) {
    hidden ||= failure instanceof WorkspaceRequestError && !!failure.deletion;
    if (!accepted && sent && !(failure instanceof WorkspaceRequestError && failure.code)) {
      hidden = true;
      throw new DeletionOutcomeUnknownError();
    }
    throw failure;
  } finally {
    if (!accepted && !hidden) controller.releaseAccountDeletion();
  }
}
