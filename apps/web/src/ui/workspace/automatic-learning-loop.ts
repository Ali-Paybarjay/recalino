import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { pendingClassRecordings } from "../recording/processing-readiness";
import type { RecordingStore } from "../recording/store";
import { workspaceRequest } from "./api";
import {
  type AutomaticLearningStatus,
  type AutomaticUploadProgress,
  automaticRecordingClasses,
  automaticRecordingMaterial,
  automaticResultNeedsRefresh,
  prepareAutomaticRecordingPhotos,
  uploadAutomaticAudio,
} from "./automatic-learning";
import {
  LEARNING_POLL,
  LearningPollSchedule,
  manualAudioPollDelay,
} from "./automatic-learning-poll";
import type { ManualAudioManager } from "./manual-audio-manager";
import { isRetryableUploadFailure } from "./upload";

/** Capture phases during which no upload starts and the class reads only kick (PRD-REC-02). */
const CAPTURE_PHASES = ["starting", "recording", "recovering", "paused", "saving"];
const CLASS_PATH = /^\/sessions\/([0-9a-f-]{36})(?:\/|$)/i;

export interface LearningLoopDeps {
  userId: string;
  store: Pick<RecordingStore, "list" | "blob"> &
    Parameters<typeof prepareAutomaticRecordingPhotos>[3]["store"];
  controller: {
    snapshot(): { phase: string; accountDeletionBlocked: boolean };
    subscribe(listener: () => void): () => void;
  };
  manualManager: Pick<ManualAudioManager, "snapshot" | "enqueue">;
  /** The latest status of each class, shared with the provider's `refresh`. */
  states: Map<string, AutomaticLearningStatus>;
  currentPath(): string;
  refresh(sessionId: string, signal?: AbortSignal): Promise<void>;
  onProblem(sessionId: string, problem: string): void;
  onMessage(sessionId: string, message: string): void;
  onTransferProgress(sessionId: string, progress: AutomaticUploadProgress): void;
  onStoreFailure(message: string): void;
  refreshPage(): void;
  request?: typeof workspaceRequest;
  upload?: typeof uploadAutomaticAudio;
  preparePhotos?: typeof prepareAutomaticRecordingPhotos;
  schedule?: LearningPollSchedule;
}
export interface LearningLoop {
  /** Makes a class (or every class) due at the next tick, whatever its backoff. */
  wake(sessionId?: string): void;
  stop(): void;
}

/**
 * The provider's background loop, outside React so its timing can be tested with fake timers:
 * every `LEARNING_POLL.baseMs` it visits the classes that are due (`LearningPollSchedule`),
 * reads their status, synchronizes a finished capture, sends saved audio of a confirmed run and
 * refreshes a newly ready result. Events (online, page shown, learning change, capture phase)
 * reset the backoff; the page being hidden pauses everything but this device's own work.
 */
export function startLearningLoop(deps: LearningLoopDeps): LearningLoop {
  const request = deps.request ?? workspaceRequest;
  const upload = deps.upload ?? uploadAutomaticAudio;
  const preparePhotos = deps.preparePhotos ?? prepareAutomaticRecordingPhotos;
  const { userId, store, controller, manualManager, states } = deps;
  const abort = new AbortController();
  let activity: AbortController | null = null;
  let running = false;
  let contract: InputContract | null = null;
  const synchronized = new Map<string, string>();
  const uploaded = new Set<string>();
  const rejectedUploads = new Set<string>();
  const ready = new Set<string>();
  const polls = deps.schedule ?? new LearningPollSchedule();
  const syncedFingerprint = (sessionId: string) => {
    const known = synchronized.get(sessionId);
    if (known !== undefined) return known;
    try {
      return (
        localStorage.getItem(`recalino:learning-recording:${userId}:${sessionId}`) ?? undefined
      );
    } catch {
      return undefined;
    }
  };
  const allowed = () => {
    abort.signal.throwIfAborted();
    if (controller.snapshot().accountDeletionBlocked)
      throw new DOMException("Account deletion is in progress.", "AbortError");
  };
  const report = (sessionId: string, problem: string) => {
    if (!abort.signal.aborted) deps.onProblem(sessionId, problem);
  };
  const tick = async () => {
    if (
      running ||
      abort.signal.aborted ||
      !navigator.onLine ||
      controller.snapshot().accountDeletionBlocked
    )
      return;
    running = true;
    try {
      const rows = await store.list(userId).catch((failure: unknown) => {
        if (!abort.signal.aborted)
          deps.onStoreFailure(
            failure instanceof Error
              ? failure.message
              : "Saved recordings could not be restored. Check device storage and retry.",
          );
        throw failure;
      });
      allowed();
      const captures = automaticRecordingClasses(rows);
      const currentClass = CLASS_PATH.exec(deps.currentPath())?.[1];
      const sessions = new Set([
        ...captures.map((capture) => capture.sessionId),
        ...rows.flatMap((row) =>
          row.sessionId && row.sourceAssetId && row.bytes > 0 ? [row.sessionId] : [],
        ),
        ...(currentClass ? [currentClass] : []),
      ]);
      const hidden = document.visibilityState === "hidden";
      for (const sessionId of sessions) {
        const status = states.get(sessionId);
        const local =
          captures.some(
            (capture) =>
              capture.sessionId === sessionId &&
              capture.fingerprint !== syncedFingerprint(sessionId),
          ) ||
          (status?.state === "waiting_upload" &&
            status.run?.state === "awaiting_upload" &&
            !uploaded.has(status.run.id) &&
            !rejectedUploads.has(status.run.id));
        if (!polls.due(sessionId, { status, viewed: sessionId === currentClass, local, hidden }))
          continue;
        const work = async () => {
          allowed();
          const operation = new AbortController();
          activity = operation;
          const cancel = () => operation.abort(abort.signal.reason);
          abort.signal.addEventListener("abort", cancel, { once: true });
          const check = () => {
            operation.signal.throwIfAborted();
            allowed();
          };
          const onProgress = (message: string) => deps.onMessage(sessionId, message);
          try {
            const before = states.get(sessionId);
            await deps.refresh(sessionId, operation.signal);
            check();
            const atStart = states.get(sessionId);
            const capture = await automaticRecordingMaterial(userId, sessionId, rows, store);
            check();
            const marker = `recalino:learning-recording:${userId}:${sessionId}`;
            let prior = synchronized.get(sessionId);
            try {
              prior ??= localStorage.getItem(marker) ?? undefined;
            } catch {
              /* Server synchronization is also idempotent. */
            }
            const capturing = CAPTURE_PHASES.includes(controller.snapshot().phase);
            // Legacy manual confirmations have no automatic_session. Discover their existing
            // awaiting run from saved originals without creating a new intent or paid run.
            if (
              !capturing &&
              atStart?.state === "idle" &&
              rows.some(
                (row) => row.sessionId === sessionId && row.sourceAssetId && row.bytes > 0,
              ) &&
              !pendingClassRecordings(rows, sessionId).length &&
              !manualManager.snapshot().some((entry) => entry.sessionId === sessionId)
            ) {
              const confirmedRuns = await request<ProcessingRun[]>(
                `/api/classes/${sessionId}/processing`,
                "GET",
                undefined,
                undefined,
                { signal: operation.signal },
              );
              check();
              const pending = confirmedRuns[0];
              if (pending?.state === "awaiting_upload") {
                const confirmed = await request<{
                  run: ProcessingRun;
                  snapshot: RunSnapshot | null;
                }>(`/api/runs/${pending.id}?includeSnapshot=1`, "GET", undefined, undefined, {
                  signal: operation.signal,
                });
                check();
                if (confirmed.run.state === "awaiting_upload" && confirmed.snapshot) {
                  contract ??= (
                    await request<{ contract: InputContract }>(
                      "/api/sources/contract",
                      "GET",
                      undefined,
                      undefined,
                      { signal: operation.signal },
                    )
                  ).contract;
                  check();
                  await manualManager.enqueue(confirmed.run, confirmed.snapshot, contract);
                }
              }
            }
            // A confirmed manual run owns this class until its saved transfer settles.
            // This also fences a finalized modern capture in the same class from syncing
            // a second intent while the existing run is still awaiting its original bytes.
            if (manualManager.snapshot().some((entry) => entry.sessionId === sessionId)) return;
            if (capture && !capturing && prior !== capture.fingerprint) {
              contract ??= (
                await request<{ contract: InputContract }>(
                  "/api/sources/contract",
                  "GET",
                  undefined,
                  undefined,
                  { signal: operation.signal },
                )
              ).contract;
              await preparePhotos(userId, capture, contract, {
                store,
                signal: operation.signal,
                checkAllowed: check,
                onProgress,
              });
              check();
              await request(
                `/api/classes/${sessionId}/learning`,
                "POST",
                { action: "sync" },
                undefined,
                { signal: operation.signal },
              );
              check();
              synchronized.set(sessionId, capture.fingerprint);
              try {
                localStorage.setItem(marker, capture.fingerprint);
              } catch {
                /* The in-memory marker prevents repeat requests. */
              }
              await deps.refresh(sessionId, operation.signal);
              check();
            }
            const status = states.get(sessionId);
            if (
              !capturing &&
              !pendingClassRecordings(rows, sessionId).length &&
              status?.state === "waiting_upload" &&
              status.run?.state === "awaiting_upload" &&
              status.snapshot &&
              !uploaded.has(status.run.id) &&
              !rejectedUploads.has(status.run.id)
            ) {
              contract ??= (
                await request<{ contract: InputContract }>(
                  "/api/sources/contract",
                  "GET",
                  undefined,
                  undefined,
                  { signal: operation.signal },
                )
              ).contract;
              try {
                await upload(status.run, status.snapshot, contract, {
                  userId,
                  store,
                  signal: operation.signal,
                  checkAllowed: check,
                  onProgress: (message) => {
                    const current = states.get(sessionId);
                    if (current?.state === "waiting_upload" && current.run?.id === status.run?.id)
                      onProgress(message);
                  },
                  onTransferProgress: (progress) => {
                    check();
                    const current = states.get(sessionId);
                    if (current?.state !== "waiting_upload" || current.run?.id !== progress.runId)
                      return;
                    deps.onTransferProgress(sessionId, progress);
                  },
                });
                uploaded.add(status.run.id);
                await deps.refresh(sessionId, operation.signal);
              } catch (failure) {
                if (
                  !isRetryableUploadFailure(failure) &&
                  !(failure instanceof DOMException && failure.name === "AbortError")
                )
                  rejectedUploads.add(status.run.id);
                throw failure;
              }
            }
            const current = states.get(sessionId);
            if (current?.state === "ready") {
              const identity = (status: AutomaticLearningStatus) =>
                `${sessionId}:${status.state}:${status.revision}:${status.run?.outputVersionId}:${status.notesReady}:${status.cardsReady}`;
              const signature = identity(current);
              if (!ready.has(signature)) {
                ready.add(signature);
                // The initial ready server render is already current. Refresh only a newly observed result.
                if (automaticResultNeedsRefresh(current, before, atStart)) deps.refreshPage();
              }
            }
          } catch (failure) {
            if (!(failure instanceof DOMException && failure.name === "AbortError"))
              report(
                sessionId,
                failure instanceof Error
                  ? failure.message
                  : "Progress will be checked again when connected.",
              );
          } finally {
            abort.signal.removeEventListener("abort", cancel);
            if (activity === operation) activity = null;
            polls.observed(sessionId, states.get(sessionId));
          }
        };
        if (navigator.locks)
          await navigator.locks.request(
            `recalino-learning:${userId}:${sessionId}`,
            { ifAvailable: true },
            async (lease) => {
              if (lease) await work();
            },
          );
        else await work();
      }
    } catch (failure) {
      const sessionId = CLASS_PATH.exec(deps.currentPath())?.[1];
      if (sessionId && !(failure instanceof DOMException && failure.name === "AbortError"))
        report(
          sessionId,
          failure instanceof Error
            ? failure.message
            : "Progress will be checked again when connected.",
        );
    } finally {
      running = false;
    }
  };
  const kick = () => {
    void tick();
  };
  /** Events reset the backoff, so a change is seen at once and the base interval resumes. */
  const wake = (event?: Event) => {
    const sessionId = event instanceof CustomEvent ? event.detail : undefined;
    polls.wake(typeof sessionId === "string" ? sessionId : undefined);
    kick();
  };
  const shown = () => {
    if (document.visibilityState !== "hidden") wake();
  };
  let capture = "";
  const unsubscribe = controller.subscribe(() => {
    const state = controller.snapshot();
    // Clock updates during capture only kick; a phase change (e.g. Stop) resets the backoff.
    const phase = `${state.phase}:${state.accountDeletionBlocked}`;
    const changed = phase !== capture;
    capture = phase;
    if (state.accountDeletionBlocked || CAPTURE_PHASES.includes(state.phase))
      activity?.abort(
        new DOMException(
          "Automatic upload is paused while capture or account deletion is in progress.",
          "AbortError",
        ),
      );
    if (changed) wake();
    else kick();
  });
  // The timer only finds classes that are due; most ticks send no request (LEARNING_POLL).
  const timer = setInterval(kick, LEARNING_POLL.baseMs);
  window.addEventListener("online", wake);
  window.addEventListener("recalino:learning-changed", wake);
  document.addEventListener("visibilitychange", shown);
  kick();
  return {
    wake: (sessionId) => {
      polls.wake(sessionId);
      kick();
    },
    stop: () => {
      abort.abort();
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("online", wake);
      window.removeEventListener("recalino:learning-changed", wake);
      document.removeEventListener("visibilitychange", shown);
    },
  };
}

/**
 * Re-checks the saved-audio queue while the page is visible: often while a transfer moves,
 * rarely while every entry waits for the learner (`manualAudioPollDelay`). Returns the stop.
 */
export function scheduleManualAudioChecks(
  manager: Pick<ManualAudioManager, "snapshot" | "subscribe">,
  kick: () => void,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const delay = manualAudioPollDelay(manager.snapshot());
    if (!active || delay === null) return;
    timer = setTimeout(() => {
      if (document.visibilityState !== "hidden") kick();
      schedule();
    }, delay);
  };
  const stopWatching = manager.subscribe(schedule);
  schedule();
  return () => {
    active = false;
    stopWatching();
    clearTimeout(timer);
  };
}
