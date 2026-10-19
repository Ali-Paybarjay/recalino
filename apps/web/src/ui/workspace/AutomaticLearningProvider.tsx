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
import { useRecording } from "../recording/RecordingProvider";
import { userMessage, workspaceRequest } from "./api";
import type { AutomaticLearningStatus, AutomaticUploadProgress } from "./automatic-learning";
import { scheduleManualAudioChecks, startLearningLoop } from "./automatic-learning-loop";
import { ManualAudioManager } from "./manual-audio-manager";
import { IndexedManualAudioStore, type ManualAudioTransfer } from "./manual-audio-store";
import { Panel, Status } from "./primitives";
import uploadStyles from "./UploadProvider.module.css";
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
            userMessage(failure, "Saved audio uploads need attention. Check device storage."),
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
            setManualProblem(userMessage(failure, "Saved audio transfers could not be restored."));
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
          setManualProblem(userMessage(failure, "Saved audio transfers could not be restored."));
      });
    const unsubscribe = controller.subscribe(captureChanged);
    const stopChecks = scheduleManualAudioChecks(manualManager, kick);
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      active = false;
      manualManager.pause();
      unsubscribe();
      stopChecks();
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [manualManager, controller]);
  useEffect(() => {
    const loop = startLearningLoop({
      userId,
      store,
      controller,
      manualManager,
      states: states.current,
      currentPath: () => path.current,
      refresh,
      onProblem: (sessionId, problem) =>
        setEntries((previous) => ({
          ...previous,
          [sessionId]: { status: previous[sessionId]?.status ?? null, problem },
        })),
      onMessage: (sessionId, message) =>
        setEntries((previous) => ({
          ...previous,
          [sessionId]: {
            status: previous[sessionId]?.status ? { ...previous[sessionId].status, message } : null,
            problem: null,
          },
        })),
      onTransferProgress: (sessionId, progress) =>
        setUploadProgress((previous) => ({ ...previous, [sessionId]: progress })),
      onStoreFailure: setManualProblem,
      refreshPage: () => router.refresh(),
    });
    wakeLearning.current = loop.wake;
    return () => {
      loop.stop();
      wakeLearning.current = () => {};
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
      <ManualAudioIndicator entries={manualAudio} problem={manualProblem} />
    </Context.Provider>
  );
}

function ManualAudioIndicator({
  entries,
  problem,
}: {
  entries: readonly ManualAudioTransfer[];
  problem: string | null;
}) {
  const { state } = useRecording();
  if (
    state.accountDeletionBlocked ||
    ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase) ||
    (!entries.length && !problem)
  )
    return null;
  return (
    <aside className={uploadStyles.tray} aria-label="Saved audio uploads">
      <Panel title="Your audio uploads">
        {problem ? <Status tone="error">{problem}</Status> : null}
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
            {/* One place for material and status: its retry is on that page, not repeated here. */}
            <Link href={`/sessions/${entry.sessionId}/sources#session-progress`}>
              View audio upload and processing
            </Link>
          </div>
        ))}
      </Panel>
    </aside>
  );
}
