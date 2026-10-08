import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectPdfNativeDependencies,
  extendNativeDependencyTraces,
} from "./trace-native-dependencies.mjs";

test("the traced PDF-owned Canvas loads from a relocated dependency tree", async () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const native = await collectPdfNativeDependencies(appRoot);
  const destination = await mkdtemp(join(tmpdir(), "recalino-native-trace-"));
  try {
    const metadata = join(destination, relative(native.projectRoot, native.pdfMetadata));
    await mkdir(dirname(metadata), { recursive: true });
    await cp(native.pdfMetadata, metadata);
    const links = [];
    for (const source of native.files) {
      const target = join(destination, relative(native.projectRoot, source));
      await mkdir(dirname(target), { recursive: true });
      if ((await lstat(source)).isSymbolicLink()) links.push({ source, target });
      else await cp(source, target);
    }
    for (const { source, target } of links) {
      const physical = join(destination, relative(native.projectRoot, await realpath(source)));
      await symlink(relative(dirname(target), physical), target, "junction");
    }
    // A separate process releases the native library before Windows test cleanup.
    const smoke = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      const canvas = createRequire(process.argv[1])('@napi-rs/canvas').createCanvas(2,2);
      const context = canvas.getContext('2d');
      context.fillStyle = 'red'; context.fillRect(0,0,2,2);
      assert.equal(context.getImageData(0,0,1,1).data[0],255);
      assert.ok(canvas.toBuffer('image/png').length > 32);
    `,
        metadata,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    assert.equal(smoke.error, undefined);
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.ok(links.some(({ source }) => source.includes("pdfjs-dist")));
  } finally {
    // This is the exact mkdtemp-created test directory, never an inferred user directory.
    await rm(destination, { recursive: true, force: true });
  }
});

test("native trace merge preserves existing files, leaves unrelated routes alone and replays identically", async () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const native = await collectPdfNativeDependencies(appRoot);
  const destination = await mkdtemp(join(tmpdir(), "recalino-native-manifest-"));
  try {
    const renderer = join(destination, "renderer.js.nft.json");
    const unrelated = join(destination, "unrelated.js.nft.json");
    const existing = "./existing-runtime.js";
    await writeFile(
      renderer,
      JSON.stringify({ version: 1, files: [existing, relative(destination, native.pdfMetadata)] }),
    );
    const untouched = JSON.stringify({ version: 1, files: [existing] });
    await writeFile(unrelated, untouched);
    const result = await extendNativeDependencyTraces(destination, native);
    assert.equal(result.manifests, 1);
    assert.equal(result.dependencies, native.files.size);
    const first = await readFile(renderer, "utf8");
    const manifest = JSON.parse(first);
    assert.ok(manifest.files.includes(existing));
    for (const dependency of native.files)
      assert.ok(manifest.files.includes(relative(destination, dependency).replaceAll("\\", "/")));
    assert.equal(await readFile(unrelated, "utf8"), untouched);
    await extendNativeDependencyTraces(destination, native);
    assert.equal(await readFile(renderer, "utf8"), first);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
