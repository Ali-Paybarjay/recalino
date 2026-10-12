import type { AutomaticLearningStatus } from "./automatic-learning";

/**
 * How often `GET /api/classes/{id}/learning` is read while nothing changes. A class with work in
 * progress, or the class being viewed, starts at `baseMs` and doubles up to `maxMs`; a class with
 * nothing in progress is read once and then only when an event wakes it.
 */
export const LEARNING_POLL = { baseMs: 3_000, maxMs: 60_000 } as const;

const ONGOING: ReadonlySet<AutomaticLearningStatus["state"]> = new Set([
  "waiting_sources",
  "waiting_upload",
  "processing",
]);

/** Server work that can change without any action on this device. Unknown status is read once. */
export function learningWorkOngoing(status: AutomaticLearningStatus | undefined): boolean {
  return (
    !status ||
    ONGOING.has(status.state) ||
    status.run?.state === "awaiting_upload" ||
    status.run?.state === "queued" ||
    status.run?.state === "processing"
  );
}

/** What a read must change to reset the backoff; the progress message alone does not. */
export function learningStatusSignature(status: AutomaticLearningStatus | undefined): string {
  if (!status) return "";
  return JSON.stringify([
    status.state,
    status.revision,
    status.batchId,
    status.lastError,
    status.run?.id,
    status.run?.state,
    status.run?.outputVersionId,
    status.notesReady,
    status.cardsReady,
  ]);
}

/** Per-class read schedule with backoff. Time is injected so tests need no timers. */
export class LearningPollSchedule {
  private entries = new Map<string, { intervalMs: number; nextAt: number; signature: string }>();
  constructor(
    private now: () => number = () => Date.now(),
    private options: { baseMs: number; maxMs: number } = LEARNING_POLL,
  ) {}

  /**
   * Whether to visit a class now. `local` marks device work only this tab can start (a finished
   * capture to synchronize or saved audio to send): it is visited while the page is hidden or the
   * class idle, still with backoff. Anything else waits while the page is hidden.
   */
  due(
    sessionId: string,
    context: {
      status: AutomaticLearningStatus | undefined;
      viewed: boolean;
      local: boolean;
      hidden: boolean;
    },
  ): boolean {
    if (context.hidden && !context.local) return false;
    const entry = this.entries.get(sessionId);
    if (!entry) return true;
    if (!context.viewed && !context.local && !learningWorkOngoing(context.status)) return false;
    return this.now() >= entry.nextAt;
  }

  /** Record a visit: an unchanged status doubles the wait, a changed one restarts it. */
  observed(sessionId: string, status: AutomaticLearningStatus | undefined) {
    const signature = learningStatusSignature(status);
    const previous = this.entries.get(sessionId);
    const intervalMs =
      previous && previous.signature === signature
        ? Math.min(this.options.maxMs, previous.intervalMs * 2)
        : this.options.baseMs;
    this.entries.set(sessionId, { intervalMs, nextAt: this.now() + intervalMs, signature });
  }

  /** An event (online, page shown, learning change, capture change) makes classes due again. */
  wake(sessionId?: string) {
    if (sessionId === undefined) this.entries.clear();
    else this.entries.delete(sessionId);
  }
}

/**
 * Delay before the saved-audio queue checks its runs again. Transfers in progress keep the base
 * interval; entries that wait for the learner only need an occasional check for a settled run.
 */
export function manualAudioPollDelay(
  entries: readonly { phase: "queued" | "uploading" | "verifying" | "attention" }[],
): number | null {
  if (!entries.length) return null;
  return entries.some((entry) => entry.phase !== "attention")
    ? LEARNING_POLL.baseMs
    : LEARNING_POLL.maxMs;
}
