import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import buildAdapter, {
  createNativeBuildAdapter,
  extendAdapterNativeAssets,
} from "./native-build-adapter.mjs";
import { collectPdfNativeDependencies } from "./trace-native-dependencies.mjs";
import { collectVoiceNativeDependencies } from "./trace-voice-native.mjs";

test("the deployment adapter receives native links, libraries and models before packaging", async () => {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [pdf, voice] = await Promise.all([
    collectPdfNativeDependencies(projectDir),
    collectVoiceNativeDependencies(projectDir),
  ]);
  const repoRoot = pdf.projectRoot;
  const output = (assets) => ({ runtime: "nodejs", assets, assetsHashes: {} });
  const renderer = output({ worker: pdf.pdfWorker });
  const probe = output({ worker: voice.workerPath, existing: voice.workerPath });
  const unrelated = output({});
  // PERF-01: a page that only loads the PDF package metadata receives no Canvas.
  const metadataOnly = output({ metadata: pdf.pdfMetadata });
  let packaged = false;
  const adapter = createNativeBuildAdapter(
    {
      name: "fixture packager",
      modifyConfig: (config) => ({ ...config, delegatedConfiguration: true }),
      onBuildComplete(ctx) {
        packaged = true;
        for (const source of pdf.files)
          assert.equal(
            ctx.outputs.appPages[0].assets[relative(repoRoot, source).replaceAll("\\", "/")],
            source,
          );
        for (const source of voice.files)
          assert.equal(
            ctx.outputs.appRoutes[0].assets[relative(repoRoot, source).replaceAll("\\", "/")],
            source,
          );
        assert.ok(
          Object.keys(renderer.assets).some(
            (key) => key.includes("pdfjs-dist") && key.endsWith("/@napi-rs/canvas"),
          ),
        );
        assert.ok(
          Object.keys(probe.assets).some((key) =>
            key.endsWith("models/wespeaker_en_voxceleb_resnet34_LM.onnx"),
          ),
        );
        assert.ok(Object.keys(probe.assets).some((key) => key.endsWith("/sherpa-onnx.node")));
        assert.equal(probe.assets.existing, voice.workerPath);
        assert.deepEqual(unrelated.assets, {});
        assert.deepEqual(metadataOnly.assets, { metadata: pdf.pdfMetadata });
      },
    },
    { pdf: async () => pdf, voice: async () => voice },
  );
  const modified = await adapter.modifyConfig({}, { projectDir });
  assert.equal(modified.delegatedConfiguration, true);
  assert.ok(modified.adapterPath.endsWith("native-build-adapter.mjs"));
  await adapter.onBuildComplete({
    repoRoot,
    projectDir,
    config: {},
    outputs: { appPages: [renderer, unrelated, metadataOnly], appRoutes: [probe] },
  });
  assert.equal(packaged, true);
});

test("the wrapper resolves the original absolute adapter and preserves its configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recalino-original-adapter-"));
  const original = process.env.NEXT_ADAPTER_PATH;
  try {
    const path = join(directory, "adapter.mjs");
    await writeFile(
      path,
      `export default {name:'fixture',modifyConfig(config,ctx){return {...config,originalPhase:ctx.phase}}};`,
    );
    process.env.NEXT_ADAPTER_PATH = path;
    const result = await buildAdapter.modifyConfig(
      { existing: true },
      { phase: "production-build" },
    );
    assert.equal(result.existing, true);
    assert.equal(result.originalPhase, "production-build");
    assert.ok(result.adapterPath.endsWith("native-build-adapter.mjs"));
  } finally {
    if (original === undefined) delete process.env.NEXT_ADAPTER_PATH;
    else process.env.NEXT_ADAPTER_PATH = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("an adapter rejects host assets and a build missing expected native outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recalino-native-adapter-"));
  try {
    const marker = join(directory, "marker");
    await writeFile(marker, "fixture");
    const ctx = {
      repoRoot: directory,
      config: {},
      outputs: { appRoutes: [{ runtime: "nodejs", assets: { marker }, assetsHashes: {} }] },
    };
    const pdf = { pdfWorker: marker, files: new Set([join(directory, "../outside-host-file")]) };
    const voice = { workerPath: marker, files: new Set([marker]) };
    await assert.rejects(
      extendAdapterNativeAssets(ctx, pdf, voice),
      /native_adapter_asset_outside_repo/,
    );
    await assert.rejects(
      extendAdapterNativeAssets({ ...ctx, outputs: {} }, pdf, voice),
      /native_adapter_expected_outputs_missing/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the adapter asset snapshot runs both PDF-owned Canvas and the voice worker after relocation", async () => {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [pdf, voice] = await Promise.all([
    collectPdfNativeDependencies(projectDir),
    collectVoiceNativeDependencies(projectDir),
  ]);
  const assets = { pdf: pdf.pdfMetadata, pdfWorker: pdf.pdfWorker, worker: voice.workerPath };
  const ctx = {
    repoRoot: pdf.projectRoot,
    config: {},
    outputs: { appRoutes: [{ runtime: "nodejs", assets, assetsHashes: {} }] },
  };
  await extendAdapterNativeAssets(ctx, pdf, voice);
  const destination = await mkdtemp(join(tmpdir(), "recalino-native-adapter-relocate-"));
  try {
    const links = [];
    for (const source of new Set(Object.values(assets))) {
      const target = join(destination, relative(ctx.repoRoot, source));
      await mkdir(dirname(target), { recursive: true });
      if ((await lstat(source)).isSymbolicLink()) links.push({ source, target });
      else await cp(source, target);
    }
    for (const { source, target } of links) {
      const physical = join(destination, relative(ctx.repoRoot, await realpath(source)));
      await symlink(relative(dirname(target), physical), target, "junction");
    }
    const smoke = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      import {join} from 'node:path';
      import {Worker} from 'node:worker_threads';
      const root=process.argv[1], pdfMetadata=process.argv[2];
      assert.equal(createRequire(pdfMetadata)('@napi-rs/canvas').createCanvas(2,2).width,2);
      const samples=new Float32Array(6*16000);
      for(let i=0;i<samples.length;i++) samples[i]=0.2*Math.sin(i/16000*140*2*Math.PI);
      const configuration={
        segmentationPath:join(root,'tools/voice/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx'),
        embeddingPath:join(root,'tools/voice/models/wespeaker_en_voxceleb_resnet34_LM.onnx'),
        modelRevision:'fixture-pinned-model',numThreads:2
      };
      async function run(operation){
        const worker=new Worker(join(root,'apps/web/src/server/voice-engine-worker.mjs'),{execArgv:[],workerData:{samples,configuration,operation,offsetMs:0}});
        try {return await new Promise((accept,reject)=>{worker.once('message',accept);worker.once('error',reject)});}
        finally{await worker.terminate()}
      }
      const embedding=await run('embed'); assert.equal(embedding.ok,true);assert.equal(embedding.value.length,256);
      const diarization=await run('diarize'); assert.equal(diarization.ok,true);assert.ok(Array.isArray(diarization.value.segments));
    `,
        destination,
        join(destination, relative(ctx.repoRoot, pdf.pdfMetadata)),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
        cwd: destination,
      },
    );
    assert.equal(smoke.error, undefined);
    assert.equal(smoke.status, 0, smoke.stderr);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
