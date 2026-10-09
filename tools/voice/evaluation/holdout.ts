/**
 * Tests the frozen calibration on the HOLDOUT split (PROTOCOL.md §7).
 *
 *   pnpm exec tsx tools/voice/evaluation/holdout.ts
 *
 * Uses calibration.json unchanged and writes holdout-report.json. Changing the policy, data or
 * gates after this report invalidates the round (PROTOCOL.md §8).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VoiceAcceptancePolicy } from "../../../packages/core/src/voc/policy.ts";
import { CONDITIONS, EVALUATION_DIR, groupsOf } from "./ami.ts";
import { protocolHash } from "./calibrate.ts";
import { assertFrozen } from "./freeze.ts";
import { targets } from "./simulate.ts";
import { resourceSummary, summarize } from "./summary.ts";

function main() {
  assertFrozen();
  const calibration = JSON.parse(
    readFileSync(join(EVALUATION_DIR, "calibration.json"), "utf8"),
  ) as {
    protocolSha256: string;
    policy: VoiceAcceptancePolicy;
  };
  if (calibration.protocolSha256 !== protocolHash())
    throw new Error("PROTOCOL.md changed after calibration; this round is invalid");
  const summary = summarize(targets("holdout"), calibration.policy);
  const meetings = [...groupsOf("calibration"), ...groupsOf("holdout")].flatMap((group) => [
    { meeting: `${group}b`, condition: "headset" as const },
    ...["c", "d"].flatMap((session) =>
      CONDITIONS.map((condition) => ({ meeting: `${group}${session}`, condition })),
    ),
  ]);
  const output = {
    protocolSha256: calibration.protocolSha256,
    split: "holdout",
    policy: calibration.policy,
    ...summary,
    resources: resourceSummary(meetings),
  };
  writeFileSync(
    join(EVALUATION_DIR, "holdout-report.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  const { trials: _trials, ...headline } = output;
  console.log(JSON.stringify(headline, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
