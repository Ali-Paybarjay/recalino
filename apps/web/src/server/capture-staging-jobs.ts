import "server-only";
import type { Database } from "@recalino/core/db";
import type { LearnerContext } from "@recalino/core/plt";
import { stagedAudioVerificationJob } from "@recalino/core/src";
import { audioVerifier } from "./audio-preparer";
import { getObjectStore } from "./storage";

/**
 * Approved by the owner on 2026-10-12 and on by default; each has a kill switch:
 * - D60 `RECALINO_CAPTURE_EARLY_UPLOAD=off`: sealed parts wait for Stop again.
 * - D61 `RECALINO_CAPTURE_EARLY_TRANSCRIPTION=off`: staged parts wait for the class run.
 */
export function captureFlags() {
  const earlyUpload = process.env.RECALINO_CAPTURE_EARLY_UPLOAD !== "off";
  return {
    earlyUpload,
    earlyTranscription: earlyUpload && process.env.RECALINO_CAPTURE_EARLY_TRANSCRIPTION !== "off",
  };
}

type StagedVerified = (db: Database, ctx: LearnerContext, assetId: string) => Promise<void>;
let onStagedVerified: StagedVerified | undefined;
/** D61 attaches background transcription here; verification itself never depends on it. */
export function setStagedVerifiedHook(hook: StagedVerified | undefined) {
  onStagedVerified = hook;
}
export function stagedAudioJobDefinition() {
  const store = getObjectStore();
  return store
    ? stagedAudioVerificationJob(store, audioVerifier(), async (db, ctx, assetId) => {
        if (captureFlags().earlyTranscription) await onStagedVerified?.(db, ctx, assetId);
      })
    : null;
}
