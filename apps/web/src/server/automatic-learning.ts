import "server-only";
import type { AiProvider } from "@recalino/core/aip";
import type { Database } from "@recalino/core/db";
import { getNotebook } from "@recalino/core/note";
import { getSession } from "@recalino/core/org";
import {
  AppError,
  emptyPayload,
  enqueueJob,
  type JobDefinition,
  type LearnerContext,
  latestJobStateForPayload,
  type PeriodicJob,
  readPltSettings,
  sha256Hex,
} from "@recalino/core/plt";
import {
  createProcessingRun,
  findProcessingRunByOperationKey,
  getAutomaticLearningSession,
  getProcessingRunSnapshot,
  getRun,
  listPendingAutomaticLearning,
  listRuns,
  type ProcessingRun,
  processingSelectionFingerprint,
  type RunSnapshot,
  reconcileAutomaticLearningBatch,
  requestAutomaticLearning,
  selectProcessingSourceSnapshot,
  sourceSnapshotSchema,
  updateAutomaticLearningProgress,
} from "@recalino/core/proc";
import {
  DefaultSourceVerifier,
  receivedSourceUploadIds,
  sessionSources,
  sourceVerificationJob,
} from "@recalino/core/src";
import type { z } from "zod";
import { getAiProvider } from "./ai";
import { publishAutomaticOutput } from "./automatic-learning-publication";
import { automaticLearningQueue } from "./automatic-learning-queue";
import { getProcessingDefinition } from "./processing-jobs";
import { getObjectStore } from "./storage";

export interface AutomaticLearningStatus {
  state: "idle" | "waiting_sources" | "waiting_upload" | "processing" | "ready" | "blocked";
  revision: number;
  batchId: string | null;
  run: ProcessingRun | null;
  snapshot: RunSnapshot | null;
  lastError: string | null;
  message: string;
  notesReady: boolean;
  cardsReady: boolean;
}
type Progress = Pick<AutomaticLearningStatus, "state" | "lastError" | "run">;
export interface AutomaticLearningDependencies {
  provider(): AiProvider | undefined;
  processing(): JobDefinition<{ runId: string; userId: string }> | null;
  now(): Date;
}
const defaults: AutomaticLearningDependencies = {
  provider: getAiProvider,
  processing: getProcessingDefinition,
  now: () => new Date(),
};
const activeStates = new Set(["awaiting_upload", "queued", "processing"]);
const completedStates = new Set(["ready", "partial_ready"]);

function problemCode(failure: unknown): string {
  if (!(failure instanceof AppError)) throw failure;
  if (["unauthenticated", "not_found"].includes(failure.code)) throw failure;
  const fields = failure.details?.fields;
  if (fields && typeof fields === "object") {
    const code = Object.values(fields)
      .flat()
      .find((value) => typeof value === "string");
    if (typeof code === "string") return code;
  }
  return failure.code;
}
export function automaticLearningMessage(
  state: AutomaticLearningStatus["state"],
  code: string | null,
): string {
  if (code === "quota_insufficient")
    return "Your material is saved. More allowance is needed to finish the notes and flashcards.";
  if (
    [
      "provider_outcome_unresolved",
      "provider_outcome_unknown",
      "provider_timestamps_invalid",
    ].includes(code ?? "")
  )
    return "Processing is paused while a provider result is checked. Your earlier notes and cards are available. Contact the operator before retrying.";
  if (["configuration_unavailable", "storage_unavailable", "settings_changed"].includes(code ?? ""))
    return "Your material is saved. Automatic creation is waiting for the service to become available.";
  if (
    [
      "provider_http_400",
      "provider_request_schema_too_complex",
      "provider_schema_unsupported",
    ].includes(code ?? "")
  )
    return "Your material was uploaded, but the AI service rejected a processing request. The service needs a fix before retrying. You do not need to upload the same files again; earlier notes and cards are saved.";
  if (code === "upload_needs_attention")
    return "An upload needs attention. Check the named files in Add material; your earlier notes and cards are available.";
  if (code === "upload_batch_cancelled")
    return "This upload group was cancelled. Your earlier notes and flashcards are available; add a new group to continue.";
  if (code === "batch_open")
    return "Waiting for this group of files to finish uploading and verification. Notes and flashcards will then update automatically.";
  if (code === "select_at_least_one")
    return "Add documents, audio or photos. Your notes and flashcards will be created automatically.";
  if (code)
    return "Automatic creation could not finish. Your material and earlier notes and cards are saved. Check the material or retry this attempt.";
  return {
    idle: "Add documents, audio or photos. Your notes and flashcards will be created automatically.",
    waiting_sources: "Waiting for uploaded files to finish verification…",
    waiting_upload:
      "Uploading the saved audio automatically. Keep this device connected until the upload finishes.",
    processing:
      "Creating your notes and flashcards automatically… You can keep using your earlier material.",
    ready: "Your notes and flashcards are up to date.",
    blocked: "Automatic creation needs attention. Your earlier notes and cards are available.",
  }[state];
}
async function view(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  progress?: Progress,
): Promise<AutomaticLearningStatus> {
  const intent = await getAutomaticLearningSession(db, ctx, sessionId);
  const notebook = await getNotebook(db, ctx, sessionId);
  const run = progress ? progress.run : intent?.runId ? await getRun(db, ctx, intent.runId) : null;
  const state = progress?.state ?? intent?.state ?? "idle";
  const code = progress ? progress.lastError : (intent?.lastError ?? null);
  return {
    state,
    revision: intent?.requestVersion ?? 0,
    batchId: intent?.batchId ?? null,
    run,
    snapshot:
      run?.state === "awaiting_upload" ? await getProcessingRunSnapshot(db, ctx, run.id) : null,
    lastError: code,
    message: automaticLearningMessage(state, code),
    notesReady: !!notebook,
    cardsReady: intent?.state === "ready" && !!notebook,
  };
}
/** Read-only polling never reserves allowance or starts provider work. */
export async function readAutomaticLearning(db: Database, ctx: LearnerContext, sessionId: string) {
  await getSession(db, ctx, sessionId);
  return view(db, ctx, sessionId);
}

/** Serializes class updates around the existing atomic reservation/run contract. */
export async function automaticLearningSync(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  options: { retryKey?: string; dependencies?: Partial<AutomaticLearningDependencies> } = {},
): Promise<AutomaticLearningStatus> {
  const deps = { ...defaults, ...options.dependencies };
  let intent = await requestAutomaticLearning(db, ctx, sessionId, {
    changed: false,
    now: deps.now(),
  });
  if (intent.batchId && intent.batchFiles)
    intent = (await reconcileAutomaticLearningBatch(db, ctx, sessionId, deps.now())) ?? intent;
  if (intent.lastError === "upload_batch_cancelled") return view(db, ctx, sessionId);
  const progress = async (
    state: Progress["state"],
    lastError: string | null,
    run: ProcessingRun | null,
  ) => {
    if (state !== "idle")
      if (
        !(await updateAutomaticLearningProgress(
          db,
          ctx,
          sessionId,
          intent.requestVersion,
          { state, lastError, runId: run?.id ?? null },
          deps.now(),
        ))
      )
        return view(db, ctx, sessionId);
    return view(db, ctx, sessionId, { state, lastError, run });
  };
  if (intent.batchId) return progress("waiting_sources", intent.lastError ?? "batch_open", null);
  const materials = await sessionSources(db, ctx, sessionId);
  if (
    materials.some(
      (source) =>
        // New documents are selected by verification, so their pending state must fence
        // processing before that selection exists. Previously verified, deselected sources
        // can still be intentionally excluded from this run.
        (source.selected || !source.verifiedAt) &&
        ["pending", "verifying"].includes(source.uploadState ?? ""),
    )
  )
    return progress("waiting_sources", null, null);
  if (
    materials.some(
      (source) => source.selected && (source.rejectionReason || source.uploadState === "rejected"),
    )
  )
    return progress("blocked", "upload_needs_attention", null);
  let snapshot: RunSnapshot;
  try {
    snapshot = sourceSnapshotSchema.parse(await selectProcessingSourceSnapshot(db, ctx, sessionId));
  } catch (failure) {
    const code = problemCode(failure);
    return progress(
      code === "select_at_least_one" || code === "not_verified" ? "waiting_sources" : "blocked",
      code,
      null,
    );
  }
  const selection = processingSelectionFingerprint(snapshot);
  const runs = await listRuns(db, ctx, sessionId);
  const active = runs.find((run) => activeStates.has(run.state));
  if (active)
    return progress(
      active.state === "awaiting_upload" ? "waiting_upload" : "processing",
      null,
      active,
    );
  const latest = runs[0];
  if (latest?.selectionFingerprint === selection && !options.retryKey) {
    if (completedStates.has(latest.state) && latest.outputVersionId) {
      await publishAutomaticOutput(db, ctx, latest, deps.now());
      return progress("ready", null, latest);
    }
    return progress("blocked", latest.lastError ?? "processing_failed", latest);
  }
  const operationKey = options.retryKey
    ? `automatic-learning:${sessionId}:retry:${sha256Hex(options.retryKey)}`
    : `automatic-learning:${selection}:${intent.requestVersion}`;
  const acknowledged = await findProcessingRunByOperationKey(db, ctx, sessionId, operationKey);
  if (acknowledged) {
    if (completedStates.has(acknowledged.state) && acknowledged.outputVersionId) {
      await publishAutomaticOutput(db, ctx, acknowledged, deps.now());
      return progress(
        acknowledged.selectionFingerprint === selection ? "ready" : "waiting_sources",
        null,
        acknowledged,
      );
    }
    return progress(
      acknowledged.state === "awaiting_upload"
        ? "waiting_upload"
        : activeStates.has(acknowledged.state)
          ? "processing"
          : "blocked",
      activeStates.has(acknowledged.state) ? null : (acknowledged.lastError ?? "processing_failed"),
      acknowledged,
    );
  }
  const processing = deps.processing();
  if (!processing) return progress("blocked", "storage_unavailable", null);
  try {
    const run = await createProcessingRun(
      db,
      ctx,
      {
        sessionId,
        operationKey,
        expectedFingerprint: snapshot.fingerprint,
        expectedSourcesVersion: snapshot.sourcesVersion,
        automaticRequestVersion: intent.requestVersion,
      },
      {
        provider: deps.provider(),
        job: processing,
        now: deps.now(),
        reuseCompletedKnowledge: !!options.retryKey,
      },
    );
    // Replayed operations after a lost acknowledgement can already be terminal.
    if (completedStates.has(run.state) && run.outputVersionId) {
      await publishAutomaticOutput(db, ctx, run, deps.now());
      return progress("ready", null, run);
    }
    return progress(
      run.state === "awaiting_upload"
        ? "waiting_upload"
        : activeStates.has(run.state)
          ? "processing"
          : "blocked",
      run.lastError,
      run,
    );
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "conflict") {
      const current = (await listRuns(db, ctx, sessionId)).find((run) =>
        activeStates.has(run.state),
      );
      if (current)
        return progress(
          current.state === "awaiting_upload" ? "waiting_upload" : "processing",
          null,
          current,
        );
    }
    const code = problemCode(failure);
    // An extraction/selection commit can race the snapshot read. Reconcile again later.
    if (code === "changed_after_estimate") return progress("waiting_sources", null, null);
    return progress("blocked", code, null);
  }
}

export function automaticLearningJob(
  dependencies: Partial<AutomaticLearningDependencies> = {},
): JobDefinition<z.infer<typeof automaticLearningQueue.payload>> {
  return {
    ...automaticLearningQueue,
    async run(payload, job) {
      const ctx = { userId: payload.userId, requestId: job.job.id };
      try {
        const intent = await getAutomaticLearningSession(job.db, ctx, payload.sessionId);
        if (
          !intent ||
          intent.requestVersion !== payload.requestVersion ||
          intent.batchId ||
          (intent.state === "blocked" &&
            !["configuration_unavailable", "storage_unavailable", "settings_changed"].includes(
              intent.lastError ?? "",
            ))
        )
          return;
        let retryKey: string | undefined;
        if (intent.state === "blocked" && intent.runId) {
          const failed = await getRun(job.db, ctx, intent.runId);
          if (
            failed.state === "failed" &&
            ["configuration_unavailable", "storage_unavailable", "settings_changed"].includes(
              failed.lastError ?? "",
            )
          )
            // Queue redelivery and periodic reconciliation acknowledge the same recovery attempt.
            retryKey = `automatic-recovery:${failed.id}:${intent.requestVersion}`;
        }
        await automaticLearningSync(job.db, ctx, payload.sessionId, {
          ...(retryKey ? { retryKey } : {}),
          dependencies: { ...dependencies, now: job.now },
        });
      } catch (failure) {
        if (failure instanceof AppError && failure.code === "not_found") return;
        throw failure;
      }
    },
  };
}
/** Notifications persist intent before queueing; the periodic reconciler recovers a failed enqueue. */
export async function scheduleAutomaticLearning(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  options: { changed?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  let intent = await requestAutomaticLearning(db, ctx, sessionId, {
    changed: options.changed ?? true,
    now,
  });
  if (intent.lastError === "upload_batch_cancelled") return;
  if (intent.batchId && intent.batchFiles) {
    const store = getObjectStore();
    // Enqueue the core contract; the app runner supplies its source notification wrapper.
    const verification = store ? sourceVerificationJob(store, new DefaultSourceVerifier()) : null;
    if (verification) {
      const sourceIds = intent.batchFiles.flatMap((file) =>
        !file.skipped && file.sourceId ? [file.sourceId] : [],
      );
      for (const uploadId of await receivedSourceUploadIds(db, ctx, sessionId, sourceIds)) {
        const existing = await latestJobStateForPayload(db, verification.kind, {
          uploadId,
          userId: ctx.userId,
        });
        if (existing && ["queued", "running", "retry_scheduled"].includes(existing)) continue;
        await db.transaction().execute((tx) =>
          enqueueJob(tx, verification, {
            payload: { uploadId, userId: ctx.userId },
            singletonKey: existing
              ? `batch-recover:${uploadId}:${Math.floor(now.getTime() / 60000)}`
              : `src:${uploadId}`,
            now,
            defaults: readPltSettings().jobs,
          }),
        );
      }
    }
    intent = (await reconcileAutomaticLearningBatch(db, ctx, sessionId, now)) ?? intent;
  }
  if (intent.batchId) return;
  await db.transaction().execute((tx) =>
    enqueueJob(tx, automaticLearningJob(), {
      payload: { sessionId, userId: ctx.userId, requestVersion: intent.requestVersion },
      singletonKey: `${sessionId}:${intent.requestVersion}:${Math.floor(now.getTime() / 60000)}`,
      now,
      defaults: readPltSettings().jobs,
    }),
  );
}
export function automaticLearningPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: 60,
      definition: {
        kind: "proc.automatic_reconcile",
        version: 1,
        payload: emptyPayload,
        async run(_payload, job) {
          for (const intent of await listPendingAutomaticLearning(job.db, 50)) {
            const ctx = { userId: intent.userId, requestId: job.job.id };
            try {
              await scheduleAutomaticLearning(job.db, ctx, intent.sessionId, {
                changed: false,
                now: job.now(),
              });
            } catch (failure) {
              if (!(failure instanceof AppError && failure.code === "not_found")) throw failure;
            }
          }
        },
      },
    },
  ];
}
