/**
 * Records what this evaluation round is bound to (PROTOCOL.md §8): the protocol, the harness,
 * the production code it runs, the pipeline settings and every AMI file it reads.
 *
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/freeze.ts --write   # once
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/freeze.ts           # check
 *
 * calibrate.ts and holdout.ts refuse to run when a frozen file has changed.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  VOICE_CLUSTER_THRESHOLD,
  VOICE_MERGE_THRESHOLD,
  VOICE_MODEL_REVISION,
  VOICE_SPAN_MODE,
} from "../../../apps/web/src/server/voice-engine.ts";
import { VOICE_WINDOW_PLAN } from "../../../apps/web/src/server/voice-source-windows.ts";
import {
  AMI_ANNOTATIONS,
  AMI_GROUPS,
  AMI_ROOT,
  amiParticipants,
  amiSplit,
  audioFile,
  EVALUATION_DIR,
} from "./ami.ts";

const ROOT = resolve(EVALUATION_DIR, "../../..");
export const FROZEN_SOURCES = [
  "tools/voice/evaluation/PROTOCOL.md",
  "tools/voice/evaluation/ami.ts",
  "tools/voice/evaluation/extract.ts",
  "tools/voice/evaluation/simulate.ts",
  "tools/voice/evaluation/summary.ts",
  "tools/voice/evaluation/calibrate.ts",
  "tools/voice/evaluation/holdout.ts",
  "packages/core/src/voc/policy.ts",
  "packages/core/src/voc/matching.ts",
  "packages/core/src/proc/voice-processing.ts",
  "apps/web/src/server/voice-engine.ts",
  "apps/web/src/server/voice-engine-worker.mjs",
  "apps/web/src/server/voice-engine-quality.mjs",
  "apps/web/src/server/voice-processing.ts",
  "apps/web/src/server/voice-sample.ts",
  "apps/web/src/server/voice-source-windows.ts",
  "apps/web/src/server/audio-preparer.ts",
] as const;

/** The pipeline settings the features were extracted with. */
export function pipelineSettings() {
  return {
    modelRevision: VOICE_MODEL_REVISION,
    clusterThreshold: VOICE_CLUSTER_THRESHOLD,
    spanMode: VOICE_SPAN_MODE,
    mergeThreshold: VOICE_MERGE_THRESHOLD,
    windowPlan: VOICE_WINDOW_PLAN,
  };
}

function sha256File(path: string): Promise<string> {
  return new Promise((accept, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => accept(hash.digest("hex")))
      .on("error", reject);
  });
}
export function sourceHashes() {
  return Object.fromEntries(
    FROZEN_SOURCES.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(join(ROOT, path)))
        .digest("hex"),
    ]),
  );
}

async function manifest() {
  const files: Record<string, string> = {};
  const add = async (path: string) => {
    files[relative(AMI_ROOT, path)] = await sha256File(path);
  };
  await add(join(AMI_ROOT, "ami_public_manual_1.6.2.zip"));
  for (const group of AMI_GROUPS) {
    for (const session of ["a", "b", "c", "d"])
      await add(audioFile(`${group}${session}`, "headset"));
    for (const session of ["c", "d"]) await add(audioFile(`${group}${session}`, "farfield"));
  }
  return {
    corpus: "AMI Meeting Corpus, CC BY 4.0",
    annotations: relative(AMI_ROOT, AMI_ANNOTATIONS),
    groups: AMI_GROUPS.map((group) => ({
      group,
      split: amiSplit(group),
      participants: [...amiParticipants(`${group}a`).values()],
    })),
    files,
  };
}

export function readFreeze(): {
  sources: Record<string, string>;
  pipeline: ReturnType<typeof pipelineSettings>;
  manifestSha256: string;
  /** Each amendment records the new hash of every file it changes (PROTOCOL.md §8). */
  amendments: { date: string; files: string[]; sha256?: Record<string, string>; reason: string }[];
} {
  return JSON.parse(readFileSync(join(EVALUATION_DIR, "freeze.json"), "utf8"));
}

/**
 * Stop if a frozen file differs from its frozen hash or, after a recorded amendment, from the
 * hash that amendment recorded (PROTOCOL.md §8). The file list is the one stored at the freeze.
 */
export function assertFrozen() {
  const freeze = readFreeze();
  const frozen = Object.keys(freeze.sources).sort();
  if (JSON.stringify(frozen) !== JSON.stringify([...FROZEN_SOURCES].sort()))
    throw new Error("the frozen file list differs from freeze.json");
  const current = sourceHashes();
  const expected = { ...freeze.sources };
  for (const amendment of freeze.amendments)
    for (const path of amendment.files) {
      const hash = amendment.sha256?.[path];
      if (!hash) throw new Error(`amendment of ${path} records no hash`);
      expected[path] = hash;
    }
  const changed = frozen.filter((path) => current[path] !== expected[path]);
  if (changed.length) throw new Error(`frozen files changed without an amendment: ${changed}`);
  if (JSON.stringify(pipelineSettings()) !== JSON.stringify(freeze.pipeline))
    throw new Error("pipeline settings differ from the freeze");
  return freeze;
}

/** SHA-256 of the manifest's compact JSON, so reformatting the committed file changes nothing. */
function manifestDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  if (process.argv.includes("--write")) {
    if (existsSync(join(EVALUATION_DIR, "freeze.json"))) throw new Error("already frozen");
    const data = await manifest();
    writeFileSync(join(EVALUATION_DIR, "ami-manifest.json"), `${JSON.stringify(data, null, 2)}\n`);
    writeFileSync(
      join(EVALUATION_DIR, "freeze.json"),
      `${JSON.stringify(
        {
          protocol: "voice-eval-ami-v1",
          frozenAt: new Date().toISOString(),
          sources: sourceHashes(),
          pipeline: pipelineSettings(),
          manifestSha256: manifestDigest(data),
          amendments: [],
        },
        null,
        2,
      )}\n`,
    );
    console.log("frozen");
    return;
  }
  assertFrozen();
  const data = await manifest();
  if (manifestDigest(data) !== readFreeze().manifestSha256)
    throw new Error("data manifest differs from the freeze");
  const committed = JSON.parse(readFileSync(join(EVALUATION_DIR, "ami-manifest.json"), "utf8"));
  if (manifestDigest(committed) !== readFreeze().manifestSha256)
    throw new Error("ami-manifest.json differs from the freeze");
  console.log("freeze verified");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
