"use client";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { pendingClassRecordings } from "../recording/processing-readiness";
import { useRecording } from "../recording/RecordingProvider";
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
import { ManualAudioManager } from "./manual-audio-manager";
import { IndexedManualAudioStore, type ManualAudioTransfer } from "./manual-audio-store";
import { Button, Panel, Status } from "./primitives";
import uploadStyles from "./UploadProvider.module.css";
import { isRetryableUploadFailure } from "./upload";
import { audioUploadRetryable } from "./upload-problems";

type Entry = { status: AutomaticLearningStatus | null; problem: string | null };
const Context = createContext<{
  entries: Record<string, Entry>;
  refresh(sessionId: string): Promise<void>;
  acceptStatus(sessionId: string, status: AutomaticLearningStatus): void;
  uploadProgress: Record<string, AutomaticUploadProgress>;
  manualAudio: readonly ManualAudioTransfer[];
  queueManualAudio(
    run: ProcessingRun,
    snapshot: RunSnapshot,
    contract: InputContract,
  ): Promise<void>;
  retryManualAudio(runId: string): Promise<void>;
  forgetManualAudio(runId: string): Promise<void>;
  cancelManualAudio(runId: string): Promise<ProcessingRun>;
} | null>(null);

export function useAutomaticLearning(sessionId: string) {
  const value = useContext(Context);
  return {
    status: value?.entries[sessionId]?.status ?? null,
    problem: value?.entries[sessionId]?.problem ?? null,
    refresh: () => value?.refresh(sessionId) ?? Promise.resolve(),
    acceptStatus: (status: AutomaticLearningStatus) => value?.acceptStatus(sessionId, status),
    uploadProgress: value?.uploadProgress[sessionId] ?? null,
    manualAudio: value?.manualAudio.filter((entry) => entry.sessionId === sessionId) ?? [],
    queueManualAudio: (run: ProcessingRun, snapshot: RunSnapshot, contract: InputContract) => {
      if (!value) throw new Error("The background upload workspace is unavailable.");
      return value.queueManualAudio(run, snapshot, contract);
    },
    retryManualAudio: (runId: string) => value?.retryManualAudio(runId) ?? Promise.resolve(),
    forgetManualAudio: (runId: string) => value?.forgetManualAudio(runId) ?? Promise.resolve(),
    cancelManualAudio: (runId: string) => {
      if (!value) throw new Error("The background upload workspace is unavailable.");
      return value.cancelManualAudio(runId);
    },
  };
}

export function AutomaticLearningProvider({ children }: { children: ReactNode }) {
  const { userId, store, controller } = useRecording();
  const router = useRouter();
  const [manualManager] = useState(
    () =>
      new ManualAudioManager(userId, new IndexedManualAudioStore(), store, {
        allowed: () =>
          !controller.snapshot().accountDeletionBlocked &&
          !["starting", "recording", "recovering", "paused", "saving"].includes(
            controller.snapshot().phase,
          ),
        lock: async (name, effect) => {
          if (navigator.locks) await navigator.locks.request(name, effect);
          else await effect();
        },
        changed: () => router.refresh(),
        failed: (failure) =>
          setManualProblem(
            failure instanceof Error
              ? failure.message
              : "Saved audio uploads need attention. Check device storage.",
          ),
      }),
  );
  const manualAudio = useSyncExternalStore(
    manualManager.subscribe,
    manualManager.snapshot,
    manualManager.snapshot,
  );
  const [manualProblem, setManualProblem] = useState<string | null>(null);
  const pathname = usePathname();
  const path = useRef(pathname);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, AutomaticUploadProgress>>({});
  const states = useRef(new Map<string, AutomaticLearningStatus>());
  const statusVersions = useRef(new Map<string, number>());
  const acceptStatus = useCallback((sessionId: string, status: AutomaticLearningStatus) => {
    statusVersions.current.set(sessionId, (statusVersions.current.get(sessionId) ?? 0) + 1);
    states.current.set(sessionId, status);
    setUploadProgress((previous) => {
      const progress = previous[sessionId];
      if (!progress || (status.state === "waiting_upload" && status.run?.id === progress.runId))
        return previous;
      const next = { ...previous };
      delete next[sessionId];
      return next;
    });
    setEntries((previous) =>
      JSON.stringify(previous[sessionId]) === JSON.stringify({ status, problem: null })
        ? previous
        : { ...previous, [sessionId]: { status, problem: null } },
    );
  }, []);
  const refresh = useCallback(
    async (sessionId: string, signal?: AbortSignal) => {
      const version = (statusVersions.current.get(sessionId) ?? 0) + 1;
      statusVersions.current.set(sessionId, version);
      const status = await workspaceRequest<AutomaticLearningStatus>(
        `/api/classes/${sessionId}/learning`,
        "GET",
        undefined,
        undefined,
        { signal },
      );
      signal?.throwIfAborted();
      // A read started before an acknowledged retry must not restore its old failure notice.
      if (statusVersions.current.get(sessionId) !== version) return;
      acceptStatus(sessionId, status);
    },
    [acceptStatus],
  );
  const wakeLearning = useRef<(sessionId?: string) => void>(() => {});
  useEffect(() => {
    path.current = pathname;
    // Opening a class reads it at once, whatever its earlier backoff.
    const viewed = /^\/sessions\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname)?.[1];
    if (viewed) wakeLearning.current(viewed);
  }, [pathname]);
  useEffect(() => {
    let active = true;
    const kick = () => {
      if (navigator.onLine)
        void manualManager.kick().catch((failure: unknown) => {
          if (active)
            setManualProblem(
              failure instanceof Error
                ? failure.message
                : "Saved audio transfers could not be restored.",
            );
        });
    };
    const captureChanged = () => {
      const state = controller.snapshot();
      if (
        state.accountDeletionBlocked ||
        ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase)
      )
        manualManager.pause();
      else {
        manualManager.resume();
        kick();
      }
    };
    captureChanged();
    void manualManager
      .restore()
      .then(kick)
      .catch((failure: unknown) => {
        if (active)
          setManualProblem(
            failure instanceof Error
              ? failure.message
              : "Saved audio transfers could not be restored.",
          );
      });
    const unsubscribe = controller.subscribe(captureChanged);
    // Saved transfers re-check their runs while the page is visible: often while a transfer is
    // in progress, rarely while every entry waits for the learner. Events still kick at once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const delay = manualAudioPollDelay(manualManager.snapshot());
      if (!active || delay === null) return;
      timer = setTimeout(() => {
        if (document.visibilityState !== "hidden") kick();
        schedule();
      }, delay);
    };
    const stopWatching = manualManager.subscribe(schedule);
    schedule();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      active = false;
      manualManager.pause();
      unsubscribe();
      stopWatching();
      clearTimeout(timer);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [manualManager, controller]);
  useEffect(() => {
    const abort = new AbortController();
    let activity: AbortController | null = null;
    let running = false;
    let contract: InputContract | null = null;
    const synchronized = new Map<string, string>();
    const uploaded = new Set<string>();
    const rejectedUploads = new Set<string>();
    const ready = new Set<string>();
    const polls = new LearningPollSchedule();
    wakeLearning.current = (sessionId) => polls.wake(sessionId);
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
      if (!abort.signal.aborted)
        setEntries((previous) => ({
          ...previous,
          [sessionId]: { status: previous[sessionId]?.status ?? null, problem },
        }));
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
            setManualProblem(
              failure instanceof Error
                ? failure.message
                : "Saved recordings could not be restored. Check device storage and retry.",
            );
          throw failure;
        });
        allowed();
        const captures = automaticRecordingClasses(rows);
        const currentClass = /^\/sessions\/([0-9a-f-]{36})(?:\/|$)/i.exec(path.current)?.[1];
        const sessions = new Set([
          ...captures.map((capture) => capture.sessionId),
          ...rows.flatMap((row) =>
            row.sessionId && row.sourceAssetId && row.bytes > 0 ? [row.sessionId] : [],
          ),
          ...(currentClass ? [currentClass] : []),
        ]);
        const hidden = document.visibilityState === "hidden";
        for (const sessionId of sessions) {
          const status = states.current.get(sessionId);
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
            const onProgress = (message: string) =>
              setEntries((previous) => ({
                ...previous,
                [sessionId]: {
                  status: previous[sessionId]?.status
                    ? { ...previous[sessionId].status, message }
                    : null,
                  problem: null,
                },
              }));
            try {
              const before = states.current.get(sessionId);
              await refresh(sessionId, operation.signal);
              check();
              const atStart = states.current.get(sessionId);
              const capture = await automaticRecordingMaterial(userId, sessionId, rows, store);
              check();
              const marker = `recalino:learning-recording:${userId}:${sessionId}`;
              let prior = synchronized.get(sessionId);
              try {
                prior ??= localStorage.getItem(marker) ?? undefined;
              } catch {
                /* Server synchronization is also idempotent. */
              }
              const capturing = [
                "starting",
                "recording",
                "recovering",
                "paused",
                "saving",
              ].includes(controller.snapshot().phase);
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
                const confirmedRuns = await workspaceRequest<ProcessingRun[]>(
                  `/api/classes/${sessionId}/processing`,
                  "GET",
                  undefined,
                  undefined,
                  { signal: operation.signal },
                );
                check();
                const pending = confirmedRuns[0];
                if (pending?.state === "awaiting_upload") {
                  const confirmed = await workspaceRequest<{
                    run: ProcessingRun;
                    snapshot: RunSnapshot | null;
                  }>(`/api/runs/${pending.id}?includeSnapshot=1`, "GET", undefined, undefined, {
                    signal: operation.signal,
                  });
                  check();
                  if (confirmed.run.state === "awaiting_upload" && confirmed.snapshot) {
                    contract ??= (
                      await workspaceRequest<{ contract: InputContract }>(
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
                  await workspaceRequest<{ contract: InputContract }>(
                    "/api/sources/contract",
                    "GET",
                    undefined,
                    undefined,
                    { signal: operation.signal },
                  )
                ).contract;
                await prepareAutomaticRecordingPhotos(userId, capture, contract, {
                  store,
                  signal: operation.signal,
                  checkAllowed: check,
                  onProgress,
                });
                check();
                await workspaceRequest(
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
                await refresh(sessionId, operation.signal);
                check();
              }
              const status = states.current.get(sessionId);
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
                  await workspaceRequest<{ contract: InputContract }>(
                    "/api/sources/contract",
                    "GET",
                    undefined,
                    undefined,
                    { signal: operation.signal },
                  )
                ).contract;
                try {
                  await uploadAutomaticAudio(status.run, status.snapshot, contract, {
                    userId,
                    store,
                    signal: operation.signal,
                    checkAllowed: check,
                    onProgress: (message) => {
                      const current = states.current.get(sessionId);
                      if (current?.state === "waiting_upload" && current.run?.id === status.run?.id)
                        onProgress(message);
                    },
                    onTransferProgress: (progress) => {
                      check();
                      const current = states.current.get(sessionId);
                      if (current?.state !== "waiting_upload" || current.run?.id !== progress.runId)
                        return;
                      setUploadProgress((previous) => ({ ...previous, [sessionId]: progress }));
                    },
                  });
                  uploaded.add(status.run.id);
                  await refresh(sessionId, operation.signal);
                } catch (failure) {
                  if (
                    !isRetryableUploadFailure(failure) &&
                    !(failure instanceof DOMException && failure.name === "AbortError")
                  )
                    rejectedUploads.add(status.run.id);
                  throw failure;
                }
              }
              const current = states.current.get(sessionId);
              if (current?.state === "ready") {
                const identity = (status: AutomaticLearningStatus) =>
                  `${sessionId}:${status.state}:${status.revision}:${status.run?.outputVersionId}:${status.notesReady}:${status.cardsReady}`;
                const signature = identity(current);
                if (!ready.has(signature)) {
                  ready.add(signature);
                  // The initial ready server render is already current. Refresh only a newly observed result.
                  if (automaticResultNeedsRefresh(current, before, atStart)) router.refresh();
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
              polls.observed(sessionId, states.current.get(sessionId));
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
        const sessionId = /^\/sessions\/([0-9a-f-]{36})(?:\/|$)/i.exec(path.current)?.[1];
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
      if (
        state.accountDeletionBlocked ||
        ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase)
      )
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
    return () => {
      abort.abort();
      wakeLearning.current = () => {};
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("online", wake);
      window.removeEventListener("recalino:learning-changed", wake);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [userId, store, controller, refresh, router, manualManager]);
  return (
    <Context.Provider
      value={{
        entries,
        refresh,
        acceptStatus,
        uploadProgress,
        manualAudio,
        queueManualAudio: (run, snapshot, contract) =>
          manualManager.enqueue(run, snapshot, contract),
        retryManualAudio: (runId) => manualManager.retry(runId),
        forgetManualAudio: (runId) => manualManager.forget(runId),
        cancelManualAudio: (runId) => manualManager.cancel(runId),
      }}
    >
      {children}
      <ManualAudioIndicator entries={manualAudio} manager={manualManager} problem={manualProblem} />
    </Context.Provider>
  );
}

function ManualAudioIndicator({
  entries,
  manager,
  problem,
}: {
  entries: readonly ManualAudioTransfer[];
  manager: ManualAudioManager;
  problem: string | null;
}) {
  const { state } = useRecording();
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  if (
    state.accountDeletionBlocked ||
    ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase) ||
    (!entries.length && !problem)
  )
    return null;
  return (
    <aside className={uploadStyles.tray} aria-label="Saved audio uploads">
      <Panel title="Your audio uploads">
        {problem || actionProblem ? <Status tone="error">{problem ?? actionProblem}</Status> : null}
        {entries.map((entry) => (
          <div key={entry.runId}>
            <p role="status">{entry.problem ?? entry.message}</p>
            {audioUploadRetryable(entry.reason) ? (
              // A closed upload never resumes; its message names the next step instead.
              <p className="preview-muted">
                You can use other pages. If your browser closes or pauses, the saved original
                resumes when you return.
              </p>
            ) : null}
            <Link href={`/sessions/${entry.sessionId}/processing`}>
              View audio upload and processing
            </Link>
            {entry.phase === "attention" && audioUploadRetryable(entry.reason) ? (
              <Button
                secondary
                onClick={() => {
                  setActionProblem(null);
                  void manager
                    .retry(entry.runId)
                    .catch((failure: unknown) =>
                      setActionProblem(
                        failure instanceof Error ? failure.message : "The upload could not resume.",
                      ),
                    );
                }}
              >
                Retry saved audio upload
              </Button>
            ) : null}
          </div>
        ))}
      </Panel>
    </aside>
  );
}
