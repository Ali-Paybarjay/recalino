import { canonicalJson, sha256Hex } from "../plt";
import type { RunSnapshot } from "./contracts";

/** Tracks the learner's selected materials and ranges independently of server extraction. */
export function processingSelectionFingerprint(snapshot: Pick<RunSnapshot, "sources">): string {
  const selection = snapshot.sources
    .map(({ sourceId, kind, sha256, ranges, captureAnchor }) => ({
      sourceId,
      kind,
      sha256,
      ranges,
      captureAnchor: captureAnchor ?? null,
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return sha256Hex(canonicalJson(selection));
}
