"use client";
import type { InputContract } from "@recalino/core/src";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { pendingClassRecordings } from "../recording/processing-readiness";
import { useRecording } from "../recording/RecordingProvider";
import { workspaceRequest } from "./api";
import {
  type AutomaticLearningStatus,
  automaticRecordingClasses,
  automaticRecordingMaterial,
  automaticResultNeedsRefresh,
  prepareAutomaticRecordingPhotos,
  uploadAutomaticAudio,
} from "./automatic-learning";
import { isRetryableUploadFailure } from "./upload";

type Entry = { status: AutomaticLearningStatus | null; problem: string | null };
const Context = createContext<{
  entries: Record<string, Entry>;
  refresh(sessionId: string): Promise<void>;
  acceptStatus(sessionId: string, status: AutomaticLearningStatus): void;
} | null>(null);

export function useAutomaticLearning(sessionId: string) {
  const value = useContext(Context);
  return {
    status: value?.entries[sessionId]?.status ?? null,
    problem: value?.entries[sessionId]?.problem ?? null,
    refresh: () => value?.refresh(sessionId) ?? Promise.resolve(),
    acceptStatus: (status: AutomaticLearningStatus) => value?.acceptStatus(sessionId, status),
  };
}

export function AutomaticLearningProvider({ children }: { children: ReactNode }) {
  const { userId, store, controller } = useRecording();
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const states = useRef(new Map<string, AutomaticLearningStatus>());
  const statusVersions = useRef(new Map<string, number>());
  const acceptStatus = useCallback((sessionId: string, status: AutomaticLearningStatus) => {
    statusVersions.current.set(sessionId, (statusVersions.current.get(sessionId) ?? 0) + 1);
    states.current.set(sessionId, status);
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
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(() => {
    const abort = new AbortController();
    let activity: AbortController | null = null;
    let running = false;
    let contract: InputContract | null = null;
    const synchronized = new Map<string, string>();
    const uploaded = new Set<string>();
    const rejectedUploads = new Set<string>();
    const ready = new Set<string>();
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
        const rows = await store.list(userId).catch(() => []);
        allowed();
        const captures = automaticRecordingClasses(rows);
        const currentClass = /^\/classes\/([0-9a-f-]{36})(?:\/|$)/i.exec(path.current)?.[1];
        const sessions = new Set([
          ...captures.map((capture) => capture.sessionId),
          ...rows.flatMap((row) =>
            row.sessionId && row.sourceAssetId && row.bytes > 0 ? [row.sessionId] : [],
          ),
          ...(currentClass ? [currentClass] : []),
        ]);
        for (const sessionId of sessions) {
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
                    onProgress,
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
        const sessionId = /^\/classes\/([0-9a-f-]{36})(?:\/|$)/i.exec(path.current)?.[1];
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
    const unsubscribe = controller.subscribe(() => {
      const state = controller.snapshot();
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
      kick();
    });
    const timer = setInterval(kick, 3000);
    window.addEventListener("online", kick);
    window.addEventListener("recalino:learning-changed", kick);
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      abort.abort();
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("online", kick);
      window.removeEventListener("recalino:learning-changed", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [userId, store, controller, refresh, router]);
  return <Context.Provider value={{ entries, refresh, acceptStatus }}>{children}</Context.Provider>;
}
