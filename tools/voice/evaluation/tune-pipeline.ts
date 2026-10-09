/**
 * Development step before the freeze: compares speaker-grouping thresholds and window plans on
 * four CALIBRATION first-class meetings only. It measures diarization quality, never an
 * identity decision, and reads no holdout audio.
 *
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/tune-pipeline.ts --threshold 0.8 --plan 30000x15 --spans clean-parts
 *
 * Selection rule, fixed before running this grid: among configurations whose impure voiceprints
 * are at most a quarter of their pure ones, the most participants with a pure voiceprint (§4 of
 * PROTOCOL.md); ties broken by fewer impure voiceprints, then by more participants with a clip,
 * then by the configuration closest to the current one. A first grid with the whole-turn rule
 * only (thresholds 0.5 and 0.65) is kept in tuning/old-overlap-rule/.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadVoiceEngine } from "../../../apps/web/src/server/voice-engine.ts";
import { AMI_ROOT, amiParticipants, amiSplit, EVALUATION_DIR } from "./ami.ts";
import { measureClass } from "./extract.ts";
import { identityOf } from "./simulate.ts";

export const TUNING_MEETINGS = ["ES2002b", "ES2005b", "IS1000b", "TS3008b"] as const;

/** Settings adopted for the frozen round: the configuration the rule above selects. */
export const PIPELINE_DECISION = "ruleSelected" as const;

/** Applies the selection rule in the header to every tuning result and writes the report. */
async function report() {
  const rows = await tuningTable();
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([row.threshold, row.spanMode, row.mergeThreshold ?? null, row.plan]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const configurations = [...groups.values()]
    .filter((items) => items.length === TUNING_MEETINGS.length)
    .map((items) => {
      const sum = (field: string) => items.reduce((total, row) => total + Number(row[field]), 0);
      const [first] = items;
      return {
        threshold: first.threshold,
        spanMode: first.spanMode,
        mergeThreshold: first.mergeThreshold ?? null,
        plan: first.plan,
        pure: sum("participantsWithPureVoiceprint"),
        impure: sum("impureVoiceprints"),
        clip: sum("participantsWithClip"),
        voices: sum("voices"),
        wallMs: sum("wallMs"),
      };
    });
  const eligible = configurations.filter((item) => item.impure * 4 <= item.pure);
  const distance = (item: (typeof configurations)[number]) =>
    Math.abs(item.threshold - 0.5) +
    (item.spanMode === "whole-turns" ? 0 : 1) +
    (item.mergeThreshold === null ? 0 : 1);
  const [selected] = [...eligible].sort(
    (a, b) =>
      b.pure - a.pure || a.impure - b.impure || b.clip - a.clip || distance(a) - distance(b),
  );
  const body = {
    meetings: TUNING_MEETINGS,
    participants: TUNING_MEETINGS.length * 4,
    note: "Calibration meetings only; diarization quality, no identity decision.",
    configurations,
    ruleSelected: selected ?? null,
    decision: PIPELINE_DECISION,
    rows,
  };
  await writeFile(join(EVALUATION_DIR, "tuning-report.json"), `${JSON.stringify(body, null, 2)}\n`);
  console.log(JSON.stringify({ configurations, selected }, null, 2));
}

async function main() {
  if (process.argv.includes("--report")) return report();
  const argument = (name: string) => {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : undefined;
  };
  const threshold = Number(argument("--threshold"));
  const spanMode = argument("--spans") === "clean-parts" ? "clean-parts" : "whole-turns";
  const merge = argument("--merge");
  const mergeThreshold = merge ? Number(merge) : null;
  const [windowMs, maxWindows] = (argument("--plan") ?? "").split("x").map(Number);
  if (!Number.isFinite(threshold) || !windowMs || !maxWindows) throw new Error("bad arguments");
  const directory = join(AMI_ROOT, "tuning");
  await mkdir(directory, { recursive: true });
  const engine = await loadVoiceEngine({ clusterThreshold: threshold, spanMode, mergeThreshold });
  for (const meeting of TUNING_MEETINGS) {
    if (amiSplit(meeting.slice(0, 6)) !== "calibration")
      throw new Error("tuning uses calibration only");
    const path = join(
      directory,
      `${meeting}.t${threshold}.p${windowMs}x${maxWindows}.${spanMode}.m${mergeThreshold ?? "none"}.json`,
    );
    if (existsSync(path)) continue;
    const feature = await measureClass(
      engine,
      meeting,
      "headset",
      { windowMs, maxWindows },
      spanMode,
    );
    const participants = [...amiParticipants(meeting).values()];
    const result = {
      meeting,
      threshold,
      spanMode,
      mergeThreshold,
      plan: { windowMs, maxWindows },
      failure: feature.failure,
      wallMs: feature.timing.wallMs,
      voices: feature.candidates.length,
      voiceprints: feature.candidates.filter((candidate) => candidate.vector).length,
      participantsWithPureVoiceprint: participants.filter((participant) =>
        feature.candidates.some(
          (candidate) => candidate.vector && identityOf(candidate, participant) === "learner",
        ),
      ).length,
      impureVoiceprints: feature.candidates.filter(
        (candidate) =>
          candidate.vector &&
          !participants.some((participant) => identityOf(candidate, participant) === "learner"),
      ).length,
      participantsWithClip: participants.filter((participant) =>
        feature.candidates.some(
          (candidate) => candidate.clips > 0 && identityOf(candidate, participant) === "learner",
        ),
      ).length,
    };
    await writeFile(path, JSON.stringify(result));
    console.log(JSON.stringify(result));
  }
}

export async function tuningTable() {
  const rows = [];
  for (const file of await readdir(join(AMI_ROOT, "tuning")))
    if (file.endsWith(".json"))
      rows.push(JSON.parse(await readFile(join(AMI_ROOT, "tuning", file), "utf8")));
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
