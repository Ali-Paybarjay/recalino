import type { CaptureState } from "./controller";

type RecordingMediaController = {
  snapshot(): CaptureState;
  subscribe(listener: () => void): () => void;
  pause(): void;
  resume(): void;
  stop(): void | Promise<void>;
};

type RecordingMediaSession = Pick<
  MediaSession,
  "metadata" | "playbackState" | "setActionHandler"
> & {
  setMicrophoneActive?: (active: boolean) => void | Promise<void>;
};

export type RecordingMediaSessionEnvironment = {
  mediaSession?: RecordingMediaSession;
  createMetadata?: (metadata: MediaMetadataInit) => MediaMetadata;
};

// These capture actions are standardized in the Media Session draft but can lag lib.dom.
export type CaptureAction = MediaSessionAction | "hangup" | "togglemicrophone";
const actions = ["pause", "play", "stop", "hangup", "togglemicrophone"] as const;
const owners = new WeakMap<RecordingMediaSession, object>();

function setCaptureActionHandler(
  session: RecordingMediaSession,
  action: CaptureAction,
  handler: MediaSessionActionHandler | null,
) {
  // The browser validates experimental action names; callers isolate unsupported actions.
  session.setActionHandler(action as MediaSessionAction, handler);
}

function browserEnvironment(): RecordingMediaSessionEnvironment {
  try {
    return {
      mediaSession: typeof navigator === "undefined" ? undefined : navigator.mediaSession,
      createMetadata:
        typeof MediaMetadata === "undefined"
          ? undefined
          : (metadata) => new MediaMetadata(metadata),
    };
  } catch {
    return {};
  }
}

function safely(action: () => void | Promise<void>) {
  try {
    void Promise.resolve(action()).catch(() => {});
  } catch {
    // Platform UI support never determines whether microphone capture can continue.
  }
}

/** Offer capture controls where the browser exposes them, without creating playback. */
export function watchRecordingMediaSession(
  controller: RecordingMediaController,
  environment: RecordingMediaSessionEnvironment = browserEnvironment(),
): () => void {
  const session = environment.mediaSession;
  if (!session) return () => {};

  const owner = {};
  const registered = new Set<(typeof actions)[number]>();
  let disposed = false;
  let lastPhase: CaptureState["phase"] | null = null;
  let lastBlocked = false;
  let metadata: MediaMetadata | null = null;
  const active = () => {
    const state = controller.snapshot();
    return (
      !disposed &&
      !state.accountDeletionBlocked &&
      ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase)
    );
  };
  const ownsSession = () => owners.get(session) === owner;
  const clear = () => {
    if (!ownsSession()) return;
    owners.delete(session);
    for (const action of registered) safely(() => setCaptureActionHandler(session, action, null));
    registered.clear();
    safely(() => {
      if (metadata && session.metadata === metadata) session.metadata = null;
    });
    metadata = null;
    safely(() => session.setMicrophoneActive?.(false));
    safely(() => {
      session.playbackState = "none";
    });
  };
  const handle = (action: (typeof actions)[number]) => {
    if (!active() || !ownsSession()) return;
    const phase = controller.snapshot().phase;
    if (action === "stop" || action === "hangup") safely(() => controller.stop());
    else if (action === "play") {
      if (phase === "paused") safely(() => controller.resume());
    } else if (action === "togglemicrophone") {
      if (phase === "paused") safely(() => controller.resume());
      else if (["starting", "recording", "recovering"].includes(phase))
        safely(() => controller.pause());
    } else if (["starting", "recording", "recovering"].includes(phase))
      safely(() => controller.pause());
  };
  const sync = () => {
    if (!active()) {
      lastPhase = null;
      clear();
      return;
    }
    const state = controller.snapshot();
    if (state.phase === lastPhase && state.accountDeletionBlocked === lastBlocked && ownsSession())
      return;
    if (!ownsSession()) {
      owners.set(session, owner);
      registered.clear();
      for (const action of actions) {
        try {
          setCaptureActionHandler(session, action, () => handle(action));
          registered.add(action);
        } catch {
          // A browser may support one media action and reject another.
        }
      }
    }
    lastPhase = state.phase;
    lastBlocked = state.accountDeletionBlocked;
    safely(() => {
      if (!environment.createMetadata) return;
      const next = environment.createMetadata({
        title:
          state.phase === "paused"
            ? "Recording paused"
            : state.phase === "recovering"
              ? "Reconnecting microphone"
              : "Class recording",
        artist: "Recalino",
        artwork: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
      });
      session.metadata = next;
      metadata = next;
    });
    safely(() => {
      // Recording is capture, not playback. The browser chooses whether to show controls.
      session.playbackState = "none";
    });
    safely(() => session.setMicrophoneActive?.(state.phase === "recording"));
  };
  const unsubscribe = controller.subscribe(sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    clear();
  };
}
