"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { workspaceRequest } from "../workspace/api";
import { Button, Status } from "../workspace/primitives";
import { watchCaptureLifecycle } from "./capture-lifecycle";
import { watchRecordingMediaSession } from "./capture-media-session";
import { RecordingController } from "./controller";
import styles from "./Recording.module.css";
import { RecordingSourceSync } from "./source-sync";
import { IndexedRecordingStore, type Recording } from "./store";

type RecordingContextValue = {
  controller: RecordingController;
  store: IndexedRecordingStore;
  userId: string;
  sourceSync: RecordingSourceSync;
};
const RecordingContext = createContext<RecordingContextValue | null>(null);
export function RecordingProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [value] = useState(() => {
    const store = new IndexedRecordingStore();
    const controller = new RecordingController(userId, store);
    return {
      userId,
      store,
      controller,
      sourceSync: new RecordingSourceSync(userId, store, controller),
    };
  });
  useEffect(() => {
    value.sourceSync.start();
    const unwatchMediaSession = watchRecordingMediaSession(value.controller);
    const unwatch = watchCaptureLifecycle(value.controller, {
      page: document,
      window,
      requestScreenWakeLock: navigator.wakeLock
        ? () => navigator.wakeLock.request("screen")
        : undefined,
    });
    return () => {
      unwatch();
      unwatchMediaSession();
      value.sourceSync.dispose();
      value.controller.dispose();
    };
  }, [value]);
  return (
    <RecordingContext.Provider value={value}>
      {children}
      <RecordingIndicator />
    </RecordingContext.Provider>
  );
}
function RecordingIndicator() {
  const { controller, state, store, userId, sourceSync, syncState } = useRecording();
  const path = usePathname();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    changed();
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  if (
    path === "/recordings" ||
    path.endsWith("/record") ||
    !["recording", "recovering", "paused", "saving", "saved", "failed"].includes(state.phase)
  )
    return null;
  async function exportAudio() {
    const row = state.recording;
    if (!row) return;
    const blob = await store.blob(userId, row.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `class-${row.id}.${row.mimeType.includes("mp4") ? "m4a" : row.mimeType.includes("ogg") ? "ogg" : "webm"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <aside className={styles.bar} aria-label="Active recording">
      <p role={state.error ? "alert" : "status"}>
        {state.error
          ? state.error
          : state.phase === "saved"
            ? "Saved on this device"
            : state.phase === "paused"
              ? "Class recording paused"
              : state.phase === "saving"
                ? "Saving your recording…"
                : state.phase === "recovering"
                  ? "Recording was interrupted. Reconnecting the microphone…"
                  : "Class recording continues"}
      </p>
      {online ? (
        <Link href="/recordings">Open recording</Link>
      ) : (
        <span>Offline · controls are available here</span>
      )}
      {syncState.pending > 0 ? (
        <p role={syncState.phase === "failed" ? "alert" : "status"}>
          {syncState.phase === "syncing"
            ? `Adding recorded parts to your class · ${syncState.pending} remaining`
            : syncState.error}
        </p>
      ) : null}
      {syncState.phase === "failed" ? (
        <Button secondary onClick={() => sourceSync.retry()}>
          Retry adding class sources
        </Button>
      ) : null}
      {["recording", "recovering"].includes(state.phase) ? (
        <Button secondary onClick={() => controller.pause()}>
          Pause recording
        </Button>
      ) : state.phase === "paused" ? (
        <Button secondary onClick={() => controller.resume()}>
          Resume recording
        </Button>
      ) : null}
      {["recording", "recovering", "paused"].includes(state.phase) ? (
        <Button secondary onClick={() => void controller.stop()}>
          Stop and save
        </Button>
      ) : null}
      {state.phase === "saved" ? (
        <Button secondary onClick={() => void exportAudio()}>
          {(state.recording?.segment ?? 1) > 1 ? "Export latest audio part" : "Export audio"}
        </Button>
      ) : null}
    </aside>
  );
}
export function useRecording() {
  const value = useContext(RecordingContext);
  if (!value) throw new Error("Recording workspace is unavailable");
  const state = useSyncExternalStore(
    value.controller.subscribe,
    value.controller.snapshot,
    value.controller.snapshot,
  );
  const syncState = useSyncExternalStore(
    value.sourceSync.subscribe,
    value.sourceSync.snapshot,
    value.sourceSync.snapshot,
  );
  return { ...value, state, syncState };
}
export async function ensureRecordingClass(recording: Recording, controller: RecordingController) {
  if (recording.sessionId) return recording.sessionId;
  const created = await workspaceRequest<{ id: string }>(
    "/api/classes",
    "POST",
    {},
    recording.creationKey,
  );
  await controller.attachSession(created.id, recording.captureId ?? recording.id);
  return created.id;
}
/** D32: microphone capture starts from this gesture before class creation needs the network. */
export function RecordLauncher({ sessionId }: { sessionId?: string }) {
  const { controller, state } = useRecording();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const busy =
    state.accountDeletionBlocked ||
    ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase);
  async function begin() {
    setError(null);
    try {
      await controller.start(sessionId ?? null);
      if (navigator.onLine) router.push(sessionId ? `/classes/${sessionId}/record` : "/recordings");
      if (!sessionId && controller.state.recording) {
        const recording = controller.state.recording;
        // A failed connection never stops capture; after saving the learner can retry.
        void workspaceRequest<{ id: string }>("/api/classes", "POST", {}, recording.creationKey)
          .then((result) =>
            controller.attachSession(result.id, recording.captureId ?? recording.id),
          )
          .catch(() => {});
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Recording could not start.");
    }
  }
  return (
    <div>
      <Button disabled={busy} onClick={begin}>
        {busy ? "Recording in progress" : "Record a class"}
      </Button>
      {error ? <Status tone="error">{error}</Status> : null}
    </div>
  );
}
