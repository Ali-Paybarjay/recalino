export const VOICE_CHECK_MAX_MS = 480000;
export const VOICE_CHECK_GAP_MS = 2000;
/** Distributed excerpts of a long selection: how long each is and how many there are. */
export interface VoiceWindowPlan {
  windowMs: number;
  maxWindows: number;
}
/**
 * Eight 58-second excerpts (478 s with separators): fewer excerpt edges cut turns than fifteen
 * 30-second ones, chosen on calibration meetings only (tools/voice/evaluation/tuning-report.json).
 */
export const VOICE_WINDOW_PLAN: VoiceWindowPlan = { windowMs: 58000, maxWindows: 8 };

export interface VoiceSourceWindow {
  start: number;
  end: number;
}
export interface VoiceWindowMap {
  sourceStartMs: number;
  compositeStartMs: number;
  compositeEndMs: number;
}

/** A bounded acoustic check samples the entire selection, never just the recording's prefix. */
export function voiceSourceWindows(
  durationMs: number,
  ranges: readonly VoiceSourceWindow[] = [],
  plan: VoiceWindowPlan = VOICE_WINDOW_PLAN,
) {
  const { windowMs, maxWindows } = plan;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new Error("voice_duration_invalid");
  const selected: VoiceSourceWindow[] = [];
  for (const range of [...(ranges.length ? ranges : [{ start: 0, end: durationMs }])].sort(
    (left, right) => left.start - right.start,
  )) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > durationMs
    )
      throw new Error("voice_selection_invalid");
    const previous = selected.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else selected.push({ ...range });
  }
  const selectedMs = selected.reduce((sum, range) => sum + range.end - range.start, 0);
  if (
    selected.length <= maxWindows &&
    selectedMs + (selected.length - 1) * VOICE_CHECK_GAP_MS <= VOICE_CHECK_MAX_MS
  )
    return { windows: selected, sampled: false };

  const windows: VoiceSourceWindow[] = [];
  for (let index = 0; index < maxWindows; index++) {
    let position = Math.floor(((index + 0.5) * selectedMs) / maxWindows);
    for (const range of selected) {
      const length = range.end - range.start;
      if (position >= length) {
        position -= length;
        continue;
      }
      const start = Math.max(
        range.start,
        Math.min(range.start + position - windowMs / 2, range.end - windowMs),
      );
      const end = Math.min(start + windowMs, range.end);
      const previous = windows.at(-1);
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
      else windows.push({ start, end });
      break;
    }
  }
  return { windows, sampled: true };
}

/** Reject a turn spanning a splice; its words or acoustic identity cannot be safely split. */
export function remapVoiceSegments<
  Segment extends { startMs: number; endMs: number; boundaryUnsafe: boolean },
>(segments: readonly Segment[], windows: readonly VoiceWindowMap[]): Segment[] {
  return segments.flatMap((segment) => {
    const window = windows.find(
      (candidate) =>
        segment.startMs >= candidate.compositeStartMs && segment.endMs <= candidate.compositeEndMs,
    );
    if (!window) return [];
    return [
      {
        ...segment,
        startMs: window.sourceStartMs + segment.startMs - window.compositeStartMs,
        endMs: window.sourceStartMs + segment.endMs - window.compositeStartMs,
        boundaryUnsafe:
          segment.boundaryUnsafe ||
          segment.startMs < window.compositeStartMs + 200 ||
          segment.endMs > window.compositeEndMs - 200,
      },
    ];
  });
}
