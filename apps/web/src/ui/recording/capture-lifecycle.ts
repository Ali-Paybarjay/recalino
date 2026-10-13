import type { CaptureState } from "./controller";

type LifecycleController = {
  snapshot(): CaptureState;
  subscribe(listener: () => void): () => void;
  checkHealth(): void;
  observe?(
    event:
      | { type: "visibility"; visible: boolean }
      | { type: "lifecycle"; state: "frozen" | "resumed" }
      | { type: "wake_lock"; state: "acquired" | "released" | "unavailable" | "failed" },
  ): void;
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
  let reportedUnavailable = false;
  const wantsWakeLock = () =>
    !disposed &&
    env.page.visibilityState === "visible" &&
    ["recording", "recovering"].includes(controller.snapshot().phase);
  const observe: NonNullable<LifecycleController["observe"]> = (event) =>
    controller.observe?.(event);
  const released = () => {
    lock?.removeEventListener("release", released);
    lock = null;
    if (wantsWakeLock()) observe({ type: "wake_lock", state: "released" });
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
    if (lock || requesting) return;
    if (!env.requestScreenWakeLock) {
      if (!reportedUnavailable) observe({ type: "wake_lock", state: "unavailable" });
      reportedUnavailable = true;
      return;
    }
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
        observe({ type: "wake_lock", state: "acquired" });
      })
      .catch(() => {
        requesting = false;
        observe({ type: "wake_lock", state: "failed" });
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
  const visibility = () => {
    if (controller.observe)
      observe({ type: "visibility", visible: env.page.visibilityState === "visible" });
    else controller.checkHealth();
    syncWakeLock();
  };
  // Page Lifecycle: a frozen page runs no code; on resume the controller measures what it missed.
  const frozen = () => observe({ type: "lifecycle", state: "frozen" });
  const resumed = () => {
    if (controller.observe) observe({ type: "lifecycle", state: "resumed" });
    else controller.checkHealth();
    syncWakeLock();
  };
  env.page.addEventListener("visibilitychange", visibility);
  env.page.addEventListener("freeze", frozen);
  env.page.addEventListener("resume", resumed);
  for (const event of ["pageshow", "online", "focus"]) {
    env.window.addEventListener(event, checkHealth);
  }
  env.window.addEventListener("beforeunload", warnBeforeLeaving);
  syncWakeLock();
  return () => {
    disposed = true;
    unsubscribe();
    env.page.removeEventListener("visibilitychange", visibility);
    env.page.removeEventListener("freeze", frozen);
    env.page.removeEventListener("resume", resumed);
    for (const event of ["pageshow", "online", "focus"]) {
      env.window.removeEventListener(event, checkHealth);
    }
    env.window.removeEventListener("beforeunload", warnBeforeLeaving);
    release();
  };
}
