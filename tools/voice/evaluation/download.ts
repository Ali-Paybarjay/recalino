/**
 * Downloads the AMI files PROTOCOL.md §2 reads into tools/voice/evaluation-data/ami/, which Git
 * ignores: the manual annotations, the headset mix of sessions a–d and the far-field array of
 * sessions c and d of every group in AMI_GROUPS (about 12 GB). Files already present are kept;
 * `freeze.ts` then checks every hash against ami-manifest.json.
 *
 *   pnpm exec tsx tools/voice/evaluation/download.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { AMI_ANNOTATIONS, AMI_AUDIO, AMI_GROUPS, AMI_ROOT, audioFile } from "./ami.ts";

const SITE = "https://groups.inf.ed.ac.uk/ami";

function download(url: string, path: string) {
  if (existsSync(path) && statSync(path).size > 0) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = spawnSync("curl", ["-sS", "--fail", "-o", `${path}.part`, url], {
      stdio: "inherit",
    });
    if (result.status === 0) {
      renameSync(`${path}.part`, path);
      return;
    }
    spawnSync("sleep", [String(2 ** attempt)]);
  }
  throw new Error(`download failed: ${basename(path)}`);
}

mkdirSync(AMI_AUDIO, { recursive: true });
const annotations = join(AMI_ROOT, "ami_public_manual_1.6.2.zip");
download(`${SITE}/AMICorpusAnnotations/ami_public_manual_1.6.2.zip`, annotations);
if (!existsSync(AMI_ANNOTATIONS)) {
  const result = spawnSync("unzip", ["-q", annotations, "-d", AMI_ANNOTATIONS], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("annotations could not be extracted");
}
for (const group of AMI_GROUPS)
  for (const session of ["a", "b", "c", "d"]) {
    const meeting = `${group}${session}`;
    const files = [audioFile(meeting, "headset")];
    if (session === "c" || session === "d") files.push(audioFile(meeting, "farfield"));
    for (const path of files)
      download(`${SITE}/AMICorpusMirror/amicorpus/${meeting}/audio/${basename(path)}`, path);
  }
console.log("AMI files present");
