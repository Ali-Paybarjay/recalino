export const VOICE_CHECK_MAX_MS = 480000;
export const VOICE_CHECK_GAP_MS = 2000;
const WINDOW_MS = 30000;
const MAX_WINDOWS = 15;

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
export function voiceSourceWindows(durationMs: number, ranges: readonly VoiceSourceWindow[] = []) {
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
    selected.length <= MAX_WINDOWS &&
    selectedMs + (selected.length - 1) * VOICE_CHECK_GAP_MS <= VOICE_CHECK_MAX_MS
  )
    return { windows: selected, sampled: false };

  const windows: VoiceSourceWindow[] = [];
  for (let index = 0; index < MAX_WINDOWS; index++) {
    let position = Math.floor(((index + 0.5) * selectedMs) / MAX_WINDOWS);
    for (const range of selected) {
      const length = range.end - range.start;
      if (position >= length) {
        position -= length;
        continue;
      }
      const start = Math.max(
        range.start,
        Math.min(range.start + position - WINDOW_MS / 2, range.end - WINDOW_MS),
      );
      const end = Math.min(start + WINDOW_MS, range.end);
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
