import type { VoiceCandidate, VoiceUtterance } from "./contracts";

const MAX_CLIPS = 3;
const MAX_CLIP_MS = 10000;

/**
 * A voice is confirmed by listening to it (D55). Stored excerpts come from clean turns or clean
 * detected speech, and a voice can have neither while it still has timed lines. Those lines can
 * play from the learner's local original, so up to three of the voice's own lines become its
 * excerpts: clean turns first, then the longest. They may be short or hold another voice; they are
 * for listening only and never spoken-mistake evidence. Only times and text are sent: no class
 * audio is cut or kept on the server (D29).
 */
export function withListeningClips(
  candidates: readonly VoiceCandidate[],
  utterances: readonly VoiceUtterance[],
): VoiceCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.clips.length) return candidate;
    const seen = new Set<string>();
    const clips = utterances
      .filter((item) => item.speakerId === candidate.id && item.endMs > item.startMs)
      .sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          b.endMs - b.startMs - (a.endMs - a.startMs) ||
          a.startMs - b.startMs,
      )
      .map((item) => ({
        startMs: item.startMs,
        endMs: Math.min(item.endMs, item.startMs + MAX_CLIP_MS),
        // Utterances may hold up to 10 000 characters; an excerpt holds at most 4 000.
        text: item.text.slice(0, 4000),
      }))
      .filter((clip) => {
        const key = `${clip.startMs}-${clip.endMs}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CLIPS)
      .sort((a, b) => a.startMs - b.startMs);
    return clips.length ? { ...candidate, clips } : candidate;
  });
}
