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
import { userMessage, workspaceRequest } from "../workspace/api";
import { Button, Status } from "../workspace/primitives";
import { watchCaptureDiagnostics } from "./capture-diagnostics";
import { watchCaptureLifecycle } from "./capture-lifecycle";
import { watchRecordingMediaSession } from "./capture-media-session";
import { captureIsQuiet } from "./capture-phase";
import { CaptureUploader } from "./capture-uploader";
import { RecordingController } from "./controller";
import { MissingAudioNotice } from "./MissingAudioNotice";
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
export function RecordingProvider({
  userId,
  children,
  captureEarlyUpload = false,
}: {
  userId: string;
  children: ReactNode;
  /** D60, decided on the server (RECALINO_CAPTURE_EARLY_UPLOAD); off means no staging at all. */
  captureEarlyUpload?: boolean;
}) {
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
    // D60/D61: sealed parts are staged silently during capture; nothing is shown until Stop.
    const uploader = captureEarlyUpload
      ? new CaptureUploader(value.userId, value.store, {
          snapshot: value.controller.snapshot,
          subscribe: value.controller.subscribe,
          attachSession: (sessionId, captureId) =>
            value.controller.attachSession(sessionId, captureId),
          report: value.controller.reportStaging,
        })
      : null;
    uploader?.start();
    const unwatchMediaSession = watchRecordingMediaSession(value.controller);
    const unwatchDiagnostics = watchCaptureDiagnostics(value.controller, {
      userAgent: navigator.userAgent,
      // keepalive lets the last batch leave while the page is being hidden or closed.
      send: (body) =>
        fetch("/api/recordings/diagnostics", {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body),
          keepalive: true,
        }),
    });
    const unwatch = watchCaptureLifecycle(value.controller, {
      page: document,
      window,
      requestScreenWakeLock: navigator.wakeLock
        ? () => navigator.wakeLock.request("screen")
        : undefined,
    });
    // D104: an unfinished capture of a page that is gone comes back paused, never recording.
    void value.controller.restore().then((restored) => {
      const recording = value.controller.state.recording;
      // Its class is created now if the lost page had no connection for it (as RecordLauncher).
      if (restored && recording && !recording.sessionId && navigator.onLine)
        void ensureRecordingClass(recording, value.controller).catch(() => {});
    });
    return () => {
      unwatch();
      unwatchDiagnostics();
      unwatchMediaSession();
      value.sourceSync.dispose();
      // Stop first: the uploader still sees the capture end and closes its lease (D104).
      value.controller.dispose();
      void uploader?.disposeAfter(value.controller.stop());
    };
  }, [value, captureEarlyUpload]);
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
              ? "Session recording paused"
              : state.phase === "saving"
                ? "Saving your recording…"
                : state.phase === "recovering"
                  ? "Recording was interrupted. Reconnecting the microphone…"
                  : "Session recording continues"}
      </p>
      {state.phase === "saved" ? <MissingAudioNotice compact missing={state.missing} /> : null}
      {online ? (
        <Link href={recordingHref(state.recording)}>Open recording</Link>
      ) : (
        <span>Offline · controls are available here</span>
      )}
      {syncState.pending > 0 ? (
        <p role={syncState.phase === "failed" ? "alert" : "status"}>
          {syncState.phase === "syncing"
            ? `Adding recorded parts to your session · ${syncState.pending} remaining`
            : syncState.error}
        </p>
      ) : null}
      {syncState.phase === "failed" ? (
        <Button secondary onClick={() => sourceSync.retry()}>
          Retry adding session material
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
/** The way back to a capture (D104): its session's recording page, else this device's list. */
export function recordingHref(recording: Recording | null) {
  return recording?.sessionId ? `/sessions/${recording.sessionId}/record` : "/recordings";
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
const NO_UPDATES = () => () => {};
/**
 * Whether capture is in progress (starting, recording, recovering or paused), when no message may
 * appear yet (PRD-REC-02). Unlike `useRecording`, it is safe outside the provider (then nothing is
 * being captured). The recording pages hide the app navigation while it is true (UX-02).
 */
export function useCaptureQuiet(): boolean {
  const value = useContext(RecordingContext);
  return useSyncExternalStore(
    value ? value.controller.subscribe : NO_UPDATES,
    () => (value ? captureIsQuiet(value.controller.snapshot().phase) : false),
    () => false,
  );
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
      if (navigator.onLine)
        router.push(sessionId ? `/sessions/${sessionId}/record` : "/recordings");
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
      setError(userMessage(failure, "Recording could not start."));
    }
  }
  return (
    <div>
      <Button disabled={busy} onClick={begin}>
        {busy ? "Recording in progress" : "Record a session"}
      </Button>
      {error ? <Status tone="error">{error}</Status> : null}
    </div>
  );
}
