// Next 16 hands its adapter a snapshot of traced assets before the build command returns.
// Add native pnpm links to that snapshot before the Vercel adapter creates function packages.
import { createHash } from "node:crypto";
import { readFile, readlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectPdfNativeDependencies } from "./trace-native-dependencies.mjs";
import { collectVoiceNativeDependencies } from "./trace-voice-native.mjs";

const adapterPath = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

async function assetHash(path, salt = "") {
  const hash = createHash("sha256").update(salt);
  try {
    const target = await readlink(path);
    hash.update("link").update(target);
  } catch (error) {
    if (error.code !== "EINVAL" && error.code !== "UNKNOWN") throw error;
    hash.update("file:").update(await readFile(path));
  }
  return hash.digest("hex");
}

export async function extendAdapterNativeAssets(ctx, pdf, voice) {
  const hashes = new Map();
  const counts = { pdfOutputs: 0, voiceOutputs: 0 };
  for (const output of [
    ...(ctx.outputs.pages ?? []),
    ...(ctx.outputs.pagesApi ?? []),
    ...(ctx.outputs.appPages ?? []),
    ...(ctx.outputs.appRoutes ?? []),
  ]) {
    if (output.runtime !== "nodejs" || !output.assets) continue;
    const existing = new Set(Object.values(output.assets).map((path) => resolve(path)));
    const files = new Set();
    if (existing.has(pdf.pdfMetadata)) {
      for (const file of pdf.files) files.add(file);
      counts.pdfOutputs++;
    }
    if (existing.has(voice.workerPath)) {
      for (const file of voice.files) files.add(file);
      counts.voiceOutputs++;
    }
    for (const path of files) {
      const name = relative(ctx.repoRoot, path);
      if (isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`))
        throw new Error("native_adapter_asset_outside_repo");
      const key = name.split(sep).join("/");
      output.assets[key] = path;
      output.assetsHashes ??= {};
      if (!hashes.has(path)) hashes.set(path, assetHash(path, ctx.config.outputHashSalt ?? ""));
      output.assetsHashes[key] = await hashes.get(path);
    }
  }
  if (!counts.pdfOutputs || !counts.voiceOutputs)
    throw new Error("native_adapter_expected_outputs_missing");
  return { ...counts, dependencies: hashes.size };
}

export function createNativeBuildAdapter(delegate, collectors = {}) {
  return {
    name: `Recalino native / ${delegate.name ?? "deployment adapter"}`,
    async modifyConfig(config, ctx) {
      const result = delegate.modifyConfig ? await delegate.modifyConfig(config, ctx) : config;
      return { ...result, adapterPath };
    },
    async onBuildComplete(ctx) {
      const [pdf, voice] = await Promise.all([
        (collectors.pdf ?? collectPdfNativeDependencies)(ctx.projectDir),
        (collectors.voice ?? collectVoiceNativeDependencies)(ctx.projectDir),
      ]);
      const result = await extendAdapterNativeAssets(ctx, pdf, voice);
      console.log(JSON.stringify({ nativeAdapterAssets: result }));
      if (typeof delegate.onBuildComplete !== "function")
        throw new Error("native_delegate_on_build_complete_missing");
      await delegate.onBuildComplete(ctx);
    },
  };
}

async function delegatedAdapter() {
  const original = process.env.NEXT_ADAPTER_PATH;
  if (!original) throw new Error("native_deployment_adapter_not_configured");
  // Vercel supplies an absolute adapter path. Resolve through Node just as Next does.
  const resolved = require.resolve(original);
  if (resolved === adapterPath) throw new Error("native_deployment_adapter_recursive");
  const module = await import(pathToFileURL(resolved).href);
  return createNativeBuildAdapter(module.default ?? module);
}

export default {
  name: "Recalino native / Vercel",
  async modifyConfig(config, ctx) {
    return (await delegatedAdapter()).modifyConfig(config, ctx);
  },
  async onBuildComplete(ctx) {
    return (await delegatedAdapter()).onBuildComplete(ctx);
  },
};
