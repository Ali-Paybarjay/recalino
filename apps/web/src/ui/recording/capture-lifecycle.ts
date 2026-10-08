import type { CaptureState } from "./controller";

type LifecycleController = {
  snapshot(): CaptureState;
  subscribe(listener: () => void): () => void;
  checkHealth(): void;
};
type ScreenWakeLock = EventTarget & { released: boolean; release(): Promise<void> };
type CaptureEnvironment = {
  page: EventTarget & { visibilityState: DocumentVisibilityState };
  window: EventTarget;
  requestScreenWakeLock?: () => Promise<ScreenWakeLock>;
};

/** Keep capture guarded across routes; screen wake lock is only a best-effort aid. */
export function watchCaptureLifecycle(controller: LifecycleController, env: CaptureEnvironment) {
  let disposed = false;
  let lock: ScreenWakeLock | null = null;
  let requesting = false;
  let epoch = 0;
  let phase = controller.snapshot().phase;
  const wantsWakeLock = () =>
    !disposed &&
    env.page.visibilityState === "visible" &&
    ["recording", "recovering"].includes(controller.snapshot().phase);
  const released = () => {
    lock?.removeEventListener("release", released);
    lock = null;
  };
  const releaseLock = (previous: ScreenWakeLock) =>
    Promise.resolve()
      .then(() => previous.release())
      .catch(() => {});
  const release = () => {
    epoch += 1;
    const previous = lock;
    lock = null;
    if (previous) {
      previous.removeEventListener("release", released);
      void releaseLock(previous);
    }
  };
  const syncWakeLock = () => {
    if (!wantsWakeLock()) {
      release();
      return;
    }
    if (lock?.released) released();
    if (lock || requesting || !env.requestScreenWakeLock) return;
    requesting = true;
    const requestedEpoch = epoch;
    const request = env.requestScreenWakeLock;
    void Promise.resolve()
      .then(request)
      .then(async (next) => {
        requesting = false;
        if (requestedEpoch !== epoch || !wantsWakeLock()) {
          await releaseLock(next);
          if (wantsWakeLock()) syncWakeLock();
          return;
        }
        lock = next;
        next.addEventListener("release", released);
      })
      .catch(() => {
        requesting = false;
      });
  };
  const checkHealth = () => {
    controller.checkHealth();
    syncWakeLock();
  };
  const warnBeforeLeaving = (event: Event) => {
    if (
      ["starting", "recording", "recovering", "paused", "saving"].includes(
        controller.snapshot().phase,
      )
    ) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    }
  };
  const unsubscribe = controller.subscribe(() => {
    const next = controller.snapshot().phase;
    if (next === phase) return;
    phase = next;
    syncWakeLock();
  });
  env.page.addEventListener("visibilitychange", checkHealth);
  for (const event of ["pageshow", "online", "focus"]) {
    env.window.addEventListener(event, checkHealth);
  }
  env.window.addEventListener("beforeunload", warnBeforeLeaving);
  syncWakeLock();
  return () => {
    disposed = true;
    unsubscribe();
    env.page.removeEventListener("visibilitychange", checkHealth);
    for (const event of ["pageshow", "online", "focus"]) {
      env.window.removeEventListener(event, checkHealth);
    }
    env.window.removeEventListener("beforeunload", warnBeforeLeaving);
    release();
  };
}
