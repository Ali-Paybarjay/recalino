import { voiceCosine } from "./matching";

/**
 * Cross-part speaker linking (PRD-SPK-02, FR-VOC-002): each recording part is diarized in its
 * own namespace, so "speaker 1" of two parts is not automatically one person. Voices of
 * different parts are joined only by their acoustic voiceprints, under these explicit rules:
 *
 * 1. Only voices with a voiceprint (at least 20 s of clean speech) of the same model revision
 *    take part. Shorter voices stay unlinked and are grouped as short voices.
 * 2. Two voices of the same part are never joined: the diarizer already kept them apart.
 * 3. Complete linkage: every pair of voices in a class voice is at least `threshold` alike.
 * 4. No close conflicting alternative: two groups are joined only when neither has another
 *    group within `margin` of the pair's similarity that could not join the pair (it shares a
 *    part with the partner, or is less alike to the partner than `threshold`). Such a voice
 *    resembles two different people's voices; both stay apart and are marked ambiguous, so the
 *    uncertainty stays visible. A third part of the same person is not a conflict: it joins next.
 *
 * Joining is greedy from the most similar pair; it is deterministic for a given input.
 */
export const VOICE_LINK_THRESHOLD = 0.65;
export const VOICE_LINK_MARGIN = 0.05;

export interface LinkableVoice {
  analysisId: string;
  speakerId: string;
  modelVersion: string;
  vector: readonly number[];
}
export interface LinkedVoice {
  /** Stable for the same members: the smallest member speaker id. */
  id: string;
  ambiguous: boolean;
  members: { analysisId: string; speakerId: string }[];
}

interface Group {
  voices: LinkableVoice[];
  ambiguous: boolean;
}

/** Complete-linkage similarity, or null when the groups share a part or a revision differs. */
function linkage(left: Group, right: Group): number | null {
  let lowest = Number.POSITIVE_INFINITY;
  for (const a of left.voices)
    for (const b of right.voices) {
      if (a.analysisId === b.analysisId || a.modelVersion !== b.modelVersion) return null;
      const similarity = voiceCosine(a.vector, b.vector);
      if (similarity === null) return null;
      lowest = Math.min(lowest, similarity);
    }
  return Number.isFinite(lowest) ? lowest : null;
}

export function linkClassVoices(
  voices: readonly LinkableVoice[],
  options: { threshold?: number; margin?: number } = {},
): LinkedVoice[] {
  const threshold = options.threshold ?? VOICE_LINK_THRESHOLD;
  const margin = options.margin ?? VOICE_LINK_MARGIN;
  const seen = new Set<string>();
  const groups: Group[] = [...voices]
    .sort(
      (a, b) => a.analysisId.localeCompare(b.analysisId) || a.speakerId.localeCompare(b.speakerId),
    )
    .filter((voice) => {
      const key = `${voice.analysisId}\u0000${voice.speakerId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((voice) => ({ voices: [voice], ambiguous: false }));
  for (;;) {
    const scores = groups.map((left, i) =>
      groups.map((right, j) => (i === j ? null : linkage(left, right))),
    );
    const pairs: { i: number; j: number; similarity: number }[] = [];
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const similarity = scores[i]?.[j];
        if (similarity !== null && similarity !== undefined && similarity >= threshold)
          pairs.push({ i, j, similarity });
      }
    pairs.sort((a, b) => b.similarity - a.similarity || a.i - b.i || a.j - b.j);
    // The closest group to `index` that could not join it together with `partner`.
    const rival = (index: number, partner: number) =>
      Math.max(
        Number.NEGATIVE_INFINITY,
        ...(scores[index] ?? []).flatMap((value, other) => {
          if (other === partner || value === null) return [];
          const withPartner = scores[partner]?.[other];
          return withPartner !== null && withPartner !== undefined && withPartner >= threshold
            ? []
            : [value];
        }),
      );
    let merged = false;
    for (const pair of pairs) {
      if (
        rival(pair.i, pair.j) > pair.similarity - margin ||
        rival(pair.j, pair.i) > pair.similarity - margin
      ) {
        const left = groups[pair.i],
          right = groups[pair.j];
        if (left) left.ambiguous = true;
        if (right) right.ambiguous = true;
        continue;
      }
      const left = groups[pair.i],
        right = groups[pair.j];
      if (!left || !right) continue;
      left.voices.push(...right.voices);
      left.ambiguous ||= right.ambiguous;
      groups.splice(pair.j, 1);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return groups.map((group) => {
    const members = group.voices
      .map(({ analysisId, speakerId }) => ({ analysisId, speakerId }))
      .sort((a, b) => a.speakerId.localeCompare(b.speakerId));
    return { id: members[0]?.speakerId ?? "", ambiguous: group.ambiguous, members };
  });
}

/** What each part stores: its linked speakers' class voice and whether the link is uncertain. */
export type SpeakerLinks = Record<string, { voiceId: string; ambiguous: boolean }>;

export function speakerLinksByAnalysis(linked: readonly LinkedVoice[]): Map<string, SpeakerLinks> {
  const result = new Map<string, SpeakerLinks>();
  for (const voice of linked)
    for (const member of voice.members) {
      const links = result.get(member.analysisId) ?? {};
      links[member.speakerId] = { voiceId: voice.id, ambiguous: voice.ambiguous };
      result.set(member.analysisId, links);
    }
  return result;
}
