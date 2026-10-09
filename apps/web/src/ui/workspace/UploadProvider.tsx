"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useRecording } from "../recording/RecordingProvider";
import { Button, Panel, Status } from "./primitives";
import styles from "./UploadProvider.module.css";
import { UploadManager } from "./upload-manager";
import { IndexedUploadStore, type UploadBatch } from "./upload-store";

const Context = createContext<UploadManager | null>(null);
const empty: UploadBatch[] = [];
const serverSnapshot = () => empty;
export function useUploads(sessionId?: string) {
  const manager = useContext(Context);
  if (!manager) throw new Error("UploadProvider is required");
  const batches = useSyncExternalStore(manager.subscribe, manager.snapshot, serverSnapshot);
  const filtered = useMemo(
    () => (sessionId ? batches.filter((batch) => batch.sessionId === sessionId) : batches),
    [batches, sessionId],
  );
  return { manager, batches: filtered };
}
export function UploadProvider({ children }: { children: ReactNode }) {
  const { userId, controller, store: recordings } = useRecording();
  const [problem, setProblem] = useState<string | null>(null);
  const [manager] = useState(
    () =>
      new UploadManager(userId, new IndexedUploadStore(), recordings, {
        allowed: () => !controller.snapshot().accountDeletionBlocked,
        lock: async (name, effect) => {
          if (navigator.locks)
            await navigator.locks.request(name, { ifAvailable: true }, async (lease) => {
              if (lease) await effect();
            });
          else await effect();
        },
      }),
  );
  useEffect(() => {
    let active = true;
    manager.resume();
    const report = (failure: unknown) => {
      if (active)
        setProblem(
          failure instanceof Error
            ? failure.message
            : "Saved uploads could not be restored. Check device storage and retry.",
        );
    };
    const kick = () => {
      if (navigator.onLine) void manager.kick().catch(report);
    };
    void manager.restore().then(kick).catch(report);
    const unsubscribe = controller.subscribe(() => {
      if (controller.snapshot().accountDeletionBlocked) manager.pause();
      else manager.resume();
    });
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    const timer = setInterval(kick, 5000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
      manager.pause();
    };
  }, [controller, manager]);
  return (
    <Context.Provider value={manager}>
      {children}
      <UploadIndicator problem={problem} />
    </Context.Provider>
  );
}
function UploadIndicator({ problem }: { problem: string | null }) {
  const { manager, batches } = useUploads();
  const { state } = useRecording();
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const act = (effect: () => Promise<unknown>) => {
    setActionProblem(null);
    void effect().catch((failure: unknown) =>
      setActionProblem(
        failure instanceof Error
          ? failure.message
          : "The upload change could not be saved. Try again.",
      ),
    );
  };
  const pathname = usePathname();
  const pending = batches.filter((batch) => !["received", "cancelled"].includes(batch.phase));
  if (["starting", "recording", "recovering", "paused", "saving"].includes(state.phase))
    return null;
  if (!pending.length && !problem) return null;
  return (
    <aside className={styles.tray} aria-label="Saved uploads">
      <Panel title="Your uploads">
        {(problem || actionProblem) && <Status tone="error">{problem ?? actionProblem}</Status>}
        {pending.map((batch) => {
          const sent = batch.entries.reduce((sum, entry) => sum + entry.sentBytes, 0);
          const total = batch.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
          return (
            <div key={batch.id}>
              <p role="status">
                {batch.phase === "attention"
                  ? batch.problem
                  : `Uploading ${batch.entries.length} files · ${Math.min(100, Math.floor((sent / Math.max(1, total)) * 100))}%`}
              </p>
              <p className="preview-muted">
                You can use other pages. If your browser pauses, your saved upload resumes when you
                return.
              </p>
              {!pathname.startsWith(`/sessions/${batch.sessionId}/sources`) && (
                <Link href={`/sessions/${batch.sessionId}/sources`}>View files and progress</Link>
              )}
              {batch.phase === "attention" && (
                <Button secondary onClick={() => act(() => manager.retry(batch.id))}>
                  Retry saved upload
                </Button>
              )}
              <Button secondary onClick={() => act(() => manager.cancel(batch.id))}>
                Cancel saved upload
              </Button>
            </div>
          );
        })}
      </Panel>
    </aside>
  );
}
