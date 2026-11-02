import { GAP_CAUSES, type GapCause } from "../../shared/capture-diagnostics-contract";
import { type MediaTimeline, RecorderTimeline } from "./media-timeline";

export { GAP_CAUSES, type GapCause } from "../../shared/capture-diagnostics-contract";
/** An interval the learner meant to record but for which no audio reached this device. */
export type CaptureGap = {
  /** The last moment audio was known to arrive before the gap (ISO, device clock). */
  from: string;
  /** When audio was seen again (ISO, device clock). */
  to: string;
  /** Position in this part's audio where the gap sits. */
  offsetMs: number;
  missingMs: number;
  cause: GapCause;
};

/** Smaller differences are delivery jitter, not lost audio. */
export const GAP_MIN_MS = 3000;
/** How far the live counter may run ahead of the last measured chunk. */
const LIVE_ALLOWANCE_MS = 6000;

/**
 * Measures one recorder run: its active (unpaused) device time against the audio its chunks
 * actually contain (PRD-REC-05). Every chunk compares the two; when device time grew by more
 * than the audio in one interval, that interval is a gap. Gradual clock drift never adds up
 * to a gap because each interval is compared on its own.
 */
export class CaptureMeter {
  private activeMs = 0;
  private since: number | null = null;
  private arrivedAt: number;
  private arrivedMedia = 0;
  private lag = 0;
  private found: CaptureGap | null = null;
  private conditions = new Map<GapCause, { active: boolean; seen: number }>();
  readonly gaps: CaptureGap[] = [];
  constructor(
    private now: () => number,
    private timeline: MediaTimeline = new RecorderTimeline(),
  ) {
    this.arrivedAt = now();
  }
  /** Device time counts only while the recorder is meant to capture. */
  run() {
    if (this.since !== null) return;
    this.since = this.now();
    // A paused interval is not a gap: measure the next one from here.
    this.arrivedAt = this.since;
  }
  halt() {
    if (this.since === null) return;
    this.activeMs += Math.max(0, this.now() - this.since);
    this.since = null;
  }
  get running() {
    return this.since !== null;
  }
  /** Record a condition: a lasting one (`active`) or a moment (`active` omitted). */
  note(cause: GapCause, active?: boolean) {
    const previous = this.conditions.get(cause);
    this.conditions.set(cause, {
      active: active ?? previous?.active ?? false,
      seen: this.now(),
    });
  }
  get measured() {
    return this.timeline.read().measured;
  }
  get kind() {
    return this.timeline.read().kind;
  }
  wallMs(at = this.now()) {
    return this.activeMs + (this.since === null ? 0 : Math.max(0, at - this.since));
  }
  /** The audio this run holds; the device clock only when its container cannot be read. */
  mediaMs() {
    const reading = this.timeline.read();
    return reading.measured ? reading.mediaMs : this.wallMs();
  }
  /** A ticking value for the screen that never runs ahead of missing audio. */
  liveMs() {
    const reading = this.timeline.read();
    if (!reading.measured) return this.wallMs();
    const pending = this.since === null ? 0 : Math.max(0, this.now() - this.arrivedAt);
    return Math.min(this.wallMs(), reading.mediaMs + Math.min(pending, LIVE_ALLOWANCE_MS));
  }
  missingMs() {
    return this.gaps.reduce((sum, gap) => sum + gap.missingMs, 0);
  }
  /** One recorder chunk, in order, with the time it arrived. Returns a newly found gap. */
  push(bytes: Uint8Array, at = this.now()): CaptureGap | null {
    this.timeline.push(bytes);
    return this.reconcile(at);
  }
  /** Compare once more after the final chunk, with device time already halted. */
  seal(at = this.now()): CaptureGap | null {
    return this.reconcile(at);
  }
  /** A gap known from outside the recorder, such as the time to reconnect a microphone. */
  addGap(gap: Omit<CaptureGap, "offsetMs">) {
    if (gap.missingMs < GAP_MIN_MS) return null;
    const added = { ...gap, offsetMs: 0, missingMs: Math.round(gap.missingMs) };
    this.gaps.push(added);
    return added;
  }
  private reconcile(at: number): CaptureGap | null {
    const reading = this.timeline.read();
    if (!reading.measured) return null;
    const lag = this.wallMs(at) - reading.mediaMs;
    const grown = lag - this.lag;
    const from = this.arrivedAt;
    const offset = this.arrivedMedia;
    this.lag = lag;
    this.arrivedAt = at;
    this.arrivedMedia = reading.mediaMs;
    if (grown >= GAP_MIN_MS) {
      const gap: CaptureGap = {
        from: new Date(from).toISOString(),
        to: new Date(at).toISOString(),
        offsetMs: Math.round(offset),
        missingMs: Math.round(grown),
        cause: this.cause(from),
      };
      this.gaps.push(gap);
      this.found = gap;
      return gap;
    }
    // A chunk delivered late looked like a gap in the previous interval; the audio came after all.
    const recent = this.found;
    this.found = null;
    if (recent && grown <= -GAP_MIN_MS / 2) {
      const kept = recent.missingMs + grown;
      if (kept >= GAP_MIN_MS) recent.missingMs = Math.round(kept);
      else this.gaps.splice(this.gaps.indexOf(recent), 1);
    }
    return null;
  }
  private cause(from: number): GapCause {
    for (const cause of GAP_CAUSES) {
      const condition = this.conditions.get(cause);
      if (condition && (condition.active || condition.seen >= from)) return cause;
    }
    return "unknown";
  }
}
