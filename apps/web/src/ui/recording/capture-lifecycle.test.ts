import { describe, expect, it, vi } from "vitest";
import { watchCaptureLifecycle } from "./capture-lifecycle";
import type { CaptureState } from "./controller";

class ScreenLock extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}
function lifecycle(requestScreenWakeLock?: () => Promise<ScreenLock>) {
  let phase: CaptureState["phase"] = "recording";
  const listeners = new Set<() => void>();
  const checkHealth = vi.fn();
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const window = new EventTarget();
  const controller = {
    snapshot: (): CaptureState => ({
      phase,
      recording: null,
      error: null,
      accountDeletionBlocked: false,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkHealth,
  };
  const dispose = watchCaptureLifecycle(controller, { page, window, requestScreenWakeLock });
  return {
    page,
    window,
    checkHealth,
    dispose,
    setPhase(next: CaptureState["phase"]) {
      phase = next;
      for (const listener of listeners) listener();
    },
  };
}
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("capture across browser lifecycle changes", () => {
  it("guards leaving during recovery and pause, and removes the guard after save or disposal", () => {
    const test = lifecycle();
    for (const phase of ["recording", "recovering", "paused", "saving"] as const) {
      test.setPhase(phase);
      const event = new Event("beforeunload", { cancelable: true });
      test.window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    test.setPhase("saved");
    const saved = new Event("beforeunload", { cancelable: true });
    test.window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
    test.setPhase("recording");
    test.dispose();
    const disposed = new Event("beforeunload", { cancelable: true });
    test.window.dispatchEvent(disposed);
    expect(disposed.defaultPrevented).toBe(false);
  });

  it("checks capture on return, releases screen lock in the background, and reacquires it when visible", async () => {
    const locks: ScreenLock[] = [];
    const request = vi.fn(async () => {
      const lock = new ScreenLock();
      locks.push(lock);
      return lock;
    });
    const test = lifecycle(request);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    test.page.visibilityState = "hidden";
    test.page.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(locks[0]?.released).toBe(true);
    test.page.visibilityState = "visible";
    test.page.dispatchEvent(new Event("visibilitychange"));
    for (const event of ["pageshow", "online", "focus"]) {
      test.window.dispatchEvent(new Event(event));
    }
    await flush();
    expect(test.checkHealth).toHaveBeenCalledTimes(5);
    expect(request).toHaveBeenCalledTimes(2);
    test.setPhase("recovering");
    expect(request).toHaveBeenCalledTimes(2);
    test.setPhase("paused");
    await flush();
    expect(locks[1]?.released).toBe(true);
    test.dispose();
    test.window.dispatchEvent(new Event("focus"));
    expect(test.checkHealth).toHaveBeenCalledTimes(5);
  });

  it("releases a late screen lock after Stop or provider disposal", async () => {
    for (const stop of [true, false]) {
      const lock = new ScreenLock();
      let resolve: ((lock: ScreenLock) => void) | undefined;
      const request = vi.fn(
        () =>
          new Promise<ScreenLock>((done) => {
            resolve = done;
          }),
      );
      const test = lifecycle(request);
      await flush();
      if (stop) test.setPhase("saved");
      else test.dispose();
      resolve?.(lock);
      await flush();
      expect(lock.release).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(1);
      test.dispose();
    }
  });

  it("retries a stale pending screen lock after pause and resume without retaining it", async () => {
    const stale = new ScreenLock();
    const current = new ScreenLock();
    let resolve: ((lock: ScreenLock) => void) | undefined;
    const request = vi
      .fn<() => Promise<ScreenLock>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(current);
    const test = lifecycle(request);
    await flush();
    test.setPhase("paused");
    test.setPhase("recording");
    resolve?.(stale);
    await flush();
    expect(stale.released).toBe(true);
    expect(current.released).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    test.dispose();
    await flush();
    expect(current.released).toBe(true);
  });

  it("tolerates an unavailable or denied wake lock and still checks capture health", async () => {
    const request = vi.fn<() => Promise<ScreenLock>>(() => {
      throw new Error("Denied");
    });
    const test = lifecycle(request);
    await flush();
    test.setPhase("recovering");
    test.window.dispatchEvent(new Event("focus"));
    await flush();
    expect(test.checkHealth).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    test.dispose();
  });
});
