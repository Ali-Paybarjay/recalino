// Native speaker inference happens in a source worker, beyond webpack's JavaScript imports.
// Trace the worker's real dependency graph and preserve pnpm symlinks and native shared libraries.

import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function collectVoiceNativeDependencies(appRoot) {
  const projectRoot = resolve(appRoot, "../..");
  const workerPath = join(appRoot, "src/server/voice-engine-worker.mjs");
  const require = createRequire(join(appRoot, "package.json"));
  const nativeRequire = createRequire(require.resolve("sherpa-onnx-node/package.json"));
  const platform = process.platform === "win32" ? "win" : process.platform;
  const binaryMetadata = await realpath(
    nativeRequire.resolve(`sherpa-onnx-${platform}-${process.arch}/package.json`),
  );
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft/index.js");
  const trace = await nodeFileTrace([workerPath], { base: projectRoot, processCwd: appRoot });
  const dependencies = new Set([...trace.fileList].map((file) => resolve(projectRoot, file)));
  const modelRoot = join(projectRoot, "tools/voice/models");
  const modelAssets = [
    "wespeaker_en_voxceleb_resnet34_LM.onnx",
    "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
    "sherpa-onnx-pyannote-segmentation-3-0/LICENSE",
    "models.manifest.json",
    "ATTRIBUTION.md",
  ];
  if (process.env.VERCEL === "1" || existsSync(modelRoot)) {
    for (const asset of modelAssets) {
      const path = join(modelRoot, asset);
      if (!existsSync(path)) throw new Error("voice_trace_model_asset_missing");
      dependencies.add(path);
    }
  }
  for (const entry of await readdir(dirname(binaryMetadata), { withFileTypes: true }))
    if (entry.isFile()) dependencies.add(join(dirname(binaryMetadata), entry.name));
  for (const path of dependencies) {
    const name = relative(projectRoot, path);
    if (isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`))
      throw new Error("voice_trace_outside_project");
    await lstat(path);
  }
  return { projectRoot, workerPath, files: dependencies };
}
async function manifests(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await manifests(path)));
    else if (entry.name.endsWith(".nft.json")) found.push(path);
  }
  return found;
}
export async function extendVoiceNativeDependencyTraces(serverDirectory, native) {
  let updated = 0;
  for (const path of await manifests(serverDirectory)) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const base = dirname(path);
    if (!manifest.files.some((name) => resolve(base, name) === native.workerPath)) continue;
    const files = new Set(manifest.files);
    for (const dependency of native.files)
      files.add(relative(base, dependency).split(sep).join("/"));
    manifest.files = [...files].sort();
    await writeFile(path, `${JSON.stringify(manifest)}\n`);
    updated++;
  }
  if (!updated) throw new Error("voice_worker_trace_missing");
  return { manifests: updated, dependencies: native.files.size };
}

export async function traceVoiceNativeDependencies(appRoot) {
  const native = await collectVoiceNativeDependencies(appRoot);
  return extendVoiceNativeDependencyTraces(join(appRoot, ".next/server"), native);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(
    JSON.stringify({ voiceNativeDependencyTrace: await traceVoiceNativeDependencies(appRoot) }),
  );
}
