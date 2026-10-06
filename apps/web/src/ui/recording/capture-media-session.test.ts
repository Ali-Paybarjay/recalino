import { afterEach, describe, expect, it, vi } from "vitest";
import { type CaptureAction, watchRecordingMediaSession } from "./capture-media-session";
import type { CaptureState } from "./controller";

afterEach(() => vi.unstubAllGlobals());

function fixture(phase: CaptureState["phase"] = "recording") {
  let state: CaptureState = { phase, recording: null, error: null, accountDeletionBlocked: false };
  const listeners = new Set<() => void>();
  const handlers = new Map<CaptureAction, MediaSessionActionHandler | null>();
  const stopResult = Promise.resolve();
  const controller = {
    snapshot: () => state,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    pause: vi.fn(() => set({ phase: "paused" })),
    resume: vi.fn(() => set({ phase: "recovering" })),
    stop: vi.fn(() => {
      set({ phase: "saving" });
      return stopResult;
    }),
  };
  const session = {
    metadata: null as MediaMetadata | null,
    playbackState: "none" as MediaSessionPlaybackState,
    setActionHandler: vi.fn((action: CaptureAction, handler: MediaSessionActionHandler | null) => {
      handlers.set(action, handler);
    }),
    setMicrophoneActive: vi.fn<(active: boolean) => void | Promise<void>>(),
  };
  const createMetadata = vi.fn((init: MediaMetadataInit) => init as MediaMetadata);
  function set(next: Partial<CaptureState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  return {
    controller,
    session,
    handlers,
    createMetadata,
    set,
    listeners,
    begin: () => watchRecordingMediaSession(controller, { mediaSession: session, createMetadata }),
    // The helper binds the action at registration and ignores browser callback details.
    invoke: (action: CaptureAction) => handlers.get(action)?.({ action: "stop" }),
  };
}

describe("optional recording controls in platform media UI", () => {
  it("is inert when Media Session is unavailable", () => {
    const test = fixture();
    const dispose = watchRecordingMediaSession(test.controller, {});
    test.set({ phase: "paused" });
    dispose();
    expect(test.controller.subscribe).not.toHaveBeenCalled();
    expect(test.controller.pause).not.toHaveBeenCalled();
    expect(test.controller.stop).not.toHaveBeenCalled();
  });

  it("reports actual capture state and metadata without claiming playback or creating audio", () => {
    const audio = vi.fn(() => {
      throw new Error("No audio playback should be created");
    });
    const createElement = vi.fn(() => {
      throw new Error("No playback elements should be created");
    });
    vi.stubGlobal("Audio", audio);
    vi.stubGlobal("document", { createElement });
    const test = fixture("idle");
    const dispose = test.begin();
    expect(test.session.setActionHandler).not.toHaveBeenCalled();
    test.set({ phase: "starting" });
    expect(test.session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    test.set({ phase: "recording" });
    expect(test.session.metadata).toMatchObject({
      title: "Class recording",
      artist: "Recalino",
      artwork: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    expect(test.session.setMicrophoneActive).toHaveBeenLastCalledWith(true);
    test.set({ phase: "recovering" });
    expect(test.session.metadata?.title).toBe("Reconnecting microphone");
    expect(test.session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    test.set({ phase: "paused" });
    expect(test.session.metadata?.title).toBe("Recording paused");
    test.set({ phase: "saving" });
    expect(test.session.playbackState).toBe("none");
    expect(test.session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    expect(audio).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    dispose();
  });

  it("routes pause and resume during recovery and ignores play until explicitly paused", () => {
    const test = fixture("recovering");
    const dispose = test.begin();
    test.invoke("play");
    expect(test.controller.resume).not.toHaveBeenCalled();
    test.invoke("pause");
    expect(test.controller.pause).toHaveBeenCalledOnce();
    expect(test.controller.snapshot().phase).toBe("paused");
    test.invoke("play");
    expect(test.controller.resume).toHaveBeenCalledOnce();
    expect(test.controller.snapshot().phase).toBe("recovering");
    test.invoke("togglemicrophone");
    expect(test.controller.pause).toHaveBeenCalledTimes(2);
    test.invoke("togglemicrophone");
    expect(test.controller.resume).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("routes stop and hangup safely and clears controls after saving", async () => {
    const test = fixture("recovering");
    const dispose = test.begin();
    test.invoke("stop");
    test.invoke("hangup");
    expect(test.controller.stop).toHaveBeenCalledTimes(2);
    expect(test.controller.snapshot().phase).toBe("saving");
    const stale = test.handlers.get("stop");
    test.set({ phase: "saved" });
    expect(test.session.metadata).toBeNull();
    expect([...test.handlers.values()].every((handler) => handler === null)).toBe(true);
    stale?.({ action: "stop" });
    expect(test.controller.stop).toHaveBeenCalledTimes(2);
    expect(test.session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    await Promise.resolve();
    dispose();
  });

  it("isolates unsupported actions, metadata failures and microphone API rejections", async () => {
    const test = fixture();
    test.session.setActionHandler.mockImplementation((action, handler) => {
      if (action === "hangup" || action === "togglemicrophone") throw new Error("Unsupported");
      test.handlers.set(action, handler);
    });
    test.createMetadata.mockImplementation(() => {
      throw new Error("Metadata unavailable");
    });
    test.session.setMicrophoneActive.mockRejectedValue(new Error("Microphone UI unavailable"));
    const dispose = test.begin();
    test.invoke("pause");
    expect(test.controller.pause).toHaveBeenCalledOnce();
    test.invoke("play");
    expect(test.controller.resume).toHaveBeenCalledOnce();
    test.invoke("stop");
    expect(test.controller.stop).toHaveBeenCalledOnce();
    expect(test.session.playbackState).toBe("none");
    dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.listeners.size).toBe(0);
  });

  it("supports browsers without microphone reporting and without a metadata constructor", () => {
    const test = fixture();
    const { setMicrophoneActive: _, ...session } = test.session;
    const dispose = watchRecordingMediaSession(test.controller, { mediaSession: session });
    test.invoke("pause");
    test.invoke("play");
    expect(test.controller.pause).toHaveBeenCalledOnce();
    expect(test.controller.resume).toHaveBeenCalledOnce();
    expect(session.metadata).toBeNull();
    dispose();
  });

  it.each(["failed", "idle"] as const)("clears owned controls on %s", (phase) => {
    const test = fixture();
    const dispose = test.begin();
    const stale = test.handlers.get("pause");
    test.set({ phase });
    expect(test.session.metadata).toBeNull();
    expect([...test.handlers.values()].every((handler) => handler === null)).toBe(true);
    stale?.({ action: "pause" });
    expect(test.controller.pause).not.toHaveBeenCalled();
    dispose();
  });

  it("blocks late actions during account deletion and after repeated unmount cleanup", () => {
    const test = fixture();
    const dispose = test.begin();
    const stale = test.handlers.get("stop");
    test.set({ accountDeletionBlocked: true });
    stale?.({ action: "stop" });
    expect(test.controller.stop).not.toHaveBeenCalled();
    expect(test.session.metadata).toBeNull();
    test.set({ accountDeletionBlocked: false });
    const afterRemount = test.handlers.get("pause");
    dispose();
    dispose();
    afterRemount?.({ action: "pause" });
    expect(test.controller.pause).not.toHaveBeenCalled();
    expect(test.listeners.size).toBe(0);
  });

  it("does not let a stale helper clear or trigger a newer helper's owned controls", () => {
    const test = fixture();
    const first = test.begin();
    const oldStop = test.handlers.get("stop");
    const second = test.begin();
    const newMetadata = test.session.metadata;
    oldStop?.({ action: "stop" });
    expect(test.controller.stop).not.toHaveBeenCalled();
    first();
    expect(test.session.metadata).toBe(newMetadata);
    test.invoke("pause");
    expect(test.controller.pause).toHaveBeenCalledOnce();
    second();
    expect(test.session.metadata).toBeNull();
    expect(test.listeners.size).toBe(0);
  });
});
