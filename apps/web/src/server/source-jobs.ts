import "server-only";
import { AppError } from "@recalino/core/plt";
import { activateProcessingRun, failAwaitingUploadRun } from "@recalino/core/proc";
import {
  DefaultSourceVerifier,
  sourceAudioVerificationJob,
  sourceMaintenanceJob,
  sourceVerificationJob,
} from "@recalino/core/src";
import { audioVerifier } from "./audio-preparer";
import { getProcessingDefinition } from "./processing-jobs";
import { getObjectStore } from "./storage";
export function sourceUploadJobDefinition() {
  const store = getObjectStore();
  return store ? sourceVerificationJob(store, new DefaultSourceVerifier()) : null;
}
export function sourceAudioJobDefinition() {
  const store = getObjectStore();
  const processing = getProcessingDefinition();
  return store && processing
    ? sourceAudioVerificationJob(
        store,
        audioVerifier(),
        async (db, ctx, runId) => {
          try {
            await activateProcessingRun(db, ctx, runId, processing);
          } catch (failure) {
            const fields = failure instanceof AppError ? failure.details?.fields : undefined;
            const problems =
              fields && typeof fields === "object" ? (fields as Record<string, unknown>) : {};
            if (
              failure instanceof AppError &&
              failure.code === "validation_failed" &&
              Array.isArray(problems.upload) &&
              problems.upload.includes("incomplete")
            )
              return;
            if (
              failure instanceof AppError &&
              failure.code === "validation_failed" &&
              [problems.audio, problems.quota].some(
                (details) =>
                  Array.isArray(details) && details.includes("new_confirmation_required"),
              )
            ) {
              await failAwaitingUploadRun(db, ctx, runId, "new_confirmation_required");
              return;
            }
            throw failure;
          }
        },
        async (db, ctx, runId) => {
          await failAwaitingUploadRun(db, ctx, runId, "audio_upload_rejected");
        },
      )
    : null;
}
export function sourceJobDefinitions() {
  return [sourceUploadJobDefinition(), sourceAudioJobDefinition()].filter((job) => job !== null);
}
export function sourcePeriodicJobs() {
  const store = getObjectStore();
  return store ? [sourceMaintenanceJob(store)] : [];
}
