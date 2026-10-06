import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("./models/", import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL("./models.manifest.json", import.meta.url), "utf8"),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function validModel(path, sha256) {
  try {
    return digest(await readFile(path)) === sha256;
  } catch {
    return false;
  }
}
async function fetchPinned(url, path, sha256) {
  try {
    if (digest(await readFile(path)) === sha256) return;
  } catch {
    /* Download absent file. */
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`model_download_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error("model_download_integrity_mismatch");
  const temporary = `${path}.download`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
}
export async function provisionVoiceModels(root = defaultRoot) {
  await mkdir(root, { recursive: true });
  const archive = join(root, "segmentation.tar.bz2");
  const licensePath = join(root, "sherpa-onnx-pyannote-segmentation-3-0/LICENSE");
  let licensePresent = false;
  try {
    licensePresent = (await readFile(licensePath, "utf8")).includes("MIT License");
  } catch {
    /* A cached model without its license must be provisioned again. */
  }
  if (
    !(await validModel(join(root, manifest.segmentation.path), manifest.segmentation.sha256)) ||
    !licensePresent
  ) {
    await fetchPinned(manifest.segmentation.url, archive, manifest.segmentation.archiveSha256);
    // The archive is verified before extraction. Its known contents stay inside this model directory.
    const extracted = spawnSync("tar", ["-xjf", archive, "-C", root], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (extracted.status !== 0) throw new Error("model_archive_extraction_failed");
    if (!(await validModel(join(root, manifest.segmentation.path), manifest.segmentation.sha256)))
      throw new Error("segmentation_integrity_mismatch");
    await rm(archive, { force: true });
  }
  await fetchPinned(
    manifest.embedding.url,
    join(root, manifest.embedding.path),
    manifest.embedding.sha256,
  );
  await writeFile(join(root, "models.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(root, "ATTRIBUTION.md"),
    `# Recalino acoustic model attribution\n\n${manifest.segmentation.attribution}. Source: ${manifest.segmentation.source}. License: MIT (the accompanying segmentation LICENSE).\n\n${manifest.embedding.attribution} Source: ${manifest.embedding.source}. License: CC-BY-4.0, https://creativecommons.org/licenses/by/4.0/.\n\nRuntime: ${manifest.runtime.package} ${manifest.runtime.version}, Apache-2.0, https://github.com/k2-fsa/sherpa-onnx. Weights are unchanged.\n`,
  );
  return { revision: manifest.revision, directory: root, verified: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  console.log(JSON.stringify(await provisionVoiceModels()));
