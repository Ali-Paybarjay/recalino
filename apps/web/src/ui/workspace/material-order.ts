import type { SourceRow } from "./source-types";

type Ordered = Pick<SourceRow, "assetId" | "kind" | "anchorSourceId" | "captureOffsetMs">;

/** Audio, then photos, then documents (PDF, HTML, plain text), then anything else. */
function group(kind: string): number {
  if (kind === "audio") return 0;
  if (kind === "image") return 1;
  return ["pdf", "html", "text"].includes(kind) ? 2 : 3;
}

/**
 * The order of a session's material list (D106). Class audio comes first in server order: the
 * parts of one recording register in part order (source-sync.ts), so they read Part 1, 2, 3.
 * Photos follow, by the part they were taken in and the moment within it; a photo without a
 * recording time keeps server order after them. Documents come last. Server order breaks every
 * tie, so a refresh never reshuffles the list.
 */
export function orderSessionMaterial<T extends Ordered>(sources: readonly T[]): T[] {
  const audio = sources.filter((source) => source.kind === "audio");
  const part = new Map(audio.map((source, index) => [source.assetId, index]));
  const moment = (source: T): [number, number] =>
    source.kind === "image" && source.anchorSourceId && source.captureOffsetMs !== null
      ? [part.get(source.anchorSourceId) ?? audio.length, source.captureOffsetMs]
      : [audio.length + 1, 0];
  return sources
    .map((source, index) => ({ source, index, group: group(source.kind), moment: moment(source) }))
    .sort(
      (a, b) =>
        a.group - b.group ||
        a.moment[0] - b.moment[0] ||
        a.moment[1] - b.moment[1] ||
        a.index - b.index,
    )
    .map((entry) => entry.source);
}

export type SessionMaterialRow<S, P> =
  | { type: "source"; key: string; source: S }
  | { type: "pending"; key: string; file: P };

/**
 * The saved material in list order, then the uploads still on their way in the order they were
 * chosen, so a new file appears at the end, just above the control that added it (D106).
 */
export function sessionMaterialRows<S extends Ordered, P extends { id: string }>(
  sources: readonly S[],
  pending: readonly P[],
): Array<SessionMaterialRow<S, P>> {
  return [
    ...orderSessionMaterial(sources).map(
      (source): SessionMaterialRow<S, P> => ({ type: "source", key: source.assetId, source }),
    ),
    ...pending.map((file): SessionMaterialRow<S, P> => ({ type: "pending", key: file.id, file })),
  ];
}
