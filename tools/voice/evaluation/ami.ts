/**
 * AMI Meeting Corpus helpers for the frozen voice-identity evaluation (PROTOCOL.md).
 * The corpus and its annotations are CC BY 4.0 (https://groups.inf.ed.ac.uk/ami/corpus/license.shtml).
 * Audio and annotations live in tools/voice/evaluation-data/ami/, which Git ignores.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EVALUATION_DIR = fileURLToPath(new URL(".", import.meta.url));
export const AMI_ROOT = resolve(EVALUATION_DIR, "../evaluation-data/ami");
export const AMI_AUDIO = join(AMI_ROOT, "audio");
export const AMI_ANNOTATIONS = join(AMI_ROOT, "annotations");
export const AMI_FEATURES = join(AMI_ROOT, "features");
export const AMI_DERIVED = join(AMI_ROOT, "derived");

/**
 * Every scenario group whose four sessions a–d have manual speaker segments for all four
 * participants (v1.6.2). IS1002 lacks session a and IS1005 lacks session d. Participants are
 * disjoint across groups.
 */
export const AMI_GROUPS = [
  "ES2002",
  "ES2003",
  "ES2004",
  "ES2005",
  "ES2006",
  "ES2007",
  "ES2008",
  "ES2009",
  "ES2010",
  "ES2011",
  "ES2012",
  "ES2013",
  "ES2014",
  "ES2015",
  "ES2016",
  "IS1000",
  "IS1001",
  "IS1003",
  "IS1004",
  "IS1006",
  "IS1007",
  "IS1008",
  "IS1009",
  "TS3003",
  "TS3004",
  "TS3005",
  "TS3006",
  "TS3007",
  "TS3008",
  "TS3009",
  "TS3010",
  "TS3011",
  "TS3012",
] as const;
export type AmiGroup = (typeof AMI_GROUPS)[number];
export type Split = "calibration" | "holdout";
export const CONDITIONS = ["headset", "farfield", "opus"] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * Pre-registered split (PROTOCOL.md §6). The first 24 groups alternate calibration, holdout
 * within each sorted site prefix. The nine groups added after the first list was found to be
 * incomplete alternate holdout, calibration within each site, so the four pipeline-tuning
 * meetings (ES2002b, ES2005b, IS1000b, TS3008b) stay in calibration.
 */
const ADDED_GROUPS = new Set([
  "ES2004",
  "ES2010",
  "ES2014",
  "IS1009",
  "TS3003",
  "TS3004",
  "TS3005",
  "TS3006",
  "TS3007",
]);
export function amiSplit(group: string): Split {
  if (!AMI_GROUPS.includes(group as AmiGroup)) throw new Error(`unknown AMI group ${group}`);
  const added = ADDED_GROUPS.has(group);
  const site = AMI_GROUPS.filter(
    (item) => item.slice(0, 2) === group.slice(0, 2) && ADDED_GROUPS.has(item) === added,
  ).sort();
  const even = site.indexOf(group as AmiGroup) % 2 === 0;
  return even === !added ? "calibration" : "holdout";
}
export function groupsOf(split: Split): AmiGroup[] {
  return AMI_GROUPS.filter((group) => amiSplit(group) === split);
}

let meetingsXml: string | undefined;
/** Agent letter (A–D) to the corpus-wide participant ID for one meeting. */
export function amiParticipants(meeting: string): Map<string, string> {
  meetingsXml ??= readFileSync(join(AMI_ANNOTATIONS, "corpusResources/meetings.xml"), "latin1");
  const block = new RegExp(`<meeting [^>]*observation="${meeting}"[^>]*>([\\s\\S]*?)</meeting>`)
    .exec(meetingsXml)
    ?.at(1);
  if (!block) throw new Error(`meeting ${meeting} missing from meetings.xml`);
  const result = new Map<string, string>();
  for (const match of block.matchAll(/nxt_agent="(\w)"[^>]*global_name="(\w+)"/g))
    if (match[1] && match[2]) result.set(match[1], match[2]);
  if (result.size !== 4) throw new Error(`meeting ${meeting} does not have four participants`);
  return result;
}

export interface AmiSegment {
  participant: string;
  startMs: number;
  endMs: number;
}
/** Manual transcriber segments of every participant, in milliseconds of the meeting audio. */
export function amiSegments(meeting: string): AmiSegment[] {
  const result: AmiSegment[] = [];
  for (const [agent, participant] of amiParticipants(meeting)) {
    const xml = readFileSync(
      join(AMI_ANNOTATIONS, "segments", `${meeting}.${agent}.segments.xml`),
      "latin1",
    );
    for (const match of xml.matchAll(/transcriber_start="([\d.]+)" transcriber_end="([\d.]+)"/g)) {
      const startMs = Math.round(Number(match[1]) * 1000),
        endMs = Math.round(Number(match[2]) * 1000);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
        result.push({ participant, startMs, endMs });
    }
  }
  return result.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** The one meeting whose first array microphone is not distributed uses the second array. */
const FARFIELD_SUBSTITUTE: Record<string, string> = { IS1007d: "Array2-02" };
export function audioFile(meeting: string, condition: Condition): string {
  if (condition === "farfield")
    return join(AMI_AUDIO, `${meeting}.${FARFIELD_SUBSTITUTE[meeting] ?? "Array1-01"}.wav`);
  if (condition === "opus") return join(AMI_DERIVED, `${meeting}.opus24.webm`);
  return join(AMI_AUDIO, `${meeting}.Mix-Headset.wav`);
}

/** Milliseconds of `[start, end)` covered by each participant's annotated speech. */
export function annotatedOverlap(
  segments: readonly AmiSegment[],
  spans: readonly { startMs: number; endMs: number }[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const span of spans)
    for (const segment of segments) {
      if (segment.startMs >= span.endMs) break;
      const overlap = Math.min(span.endMs, segment.endMs) - Math.max(span.startMs, segment.startMs);
      if (overlap > 0)
        result.set(segment.participant, (result.get(segment.participant) ?? 0) + overlap);
    }
  return result;
}
