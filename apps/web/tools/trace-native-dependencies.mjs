// PDF.js uses process.getBuiltinModule('module').createRequire for its optional Canvas.
// Next's static tracer cannot see that lookup. Trace the real installed dependency graph,
// including symlink nodes themselves, rather than globbing files beneath symlink directories.
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function inside(base, path) {
  const name = relative(base, path);
  return name === "" || (!isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`));
}

export async function collectPdfNativeDependencies(appRoot) {
  const projectRoot = resolve(appRoot, "../..");
  const appRequire = createRequire(join(appRoot, "package.json"));
  const pdfMetadata = await realpath(appRequire.resolve("pdfjs-dist/package.json"));
  const pdfRequire = createRequire(pdfMetadata);
  const canvasEntry = await realpath(pdfRequire.resolve("@napi-rs/canvas"));
  const canvasDirectory = dirname(canvasEntry);
  const canvasLookups = pdfRequire.resolve.paths("@napi-rs/canvas") ?? [];
  let ownCanvasEntry;
  for (const lookup of canvasLookups) {
    const candidate = join(lookup, "@napi-rs/canvas");
    try {
      if ((await realpath(candidate)) === canvasDirectory) {
        ownCanvasEntry = join(candidate, "index.js");
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!ownCanvasEntry) throw new Error("native_pdf_canvas_resolution_missing");
  // The app also imports Canvas directly. Tracing both entry paths preserves both links.
  const appCanvasEntry = join(appRoot, "node_modules/@napi-rs/canvas/index.js");
  const { nodeFileTrace } = appRequire("next/dist/compiled/@vercel/nft/index.js");
  const trace = await nodeFileTrace([ownCanvasEntry, appCanvasEntry], {
    base: projectRoot,
    processCwd: appRoot,
  });
  const files = new Set([...trace.fileList].map((name) => resolve(projectRoot, name)));
  // Reject any host files or expanded children beneath symlinks before publishing a trace.
  const links = [];
  for (const path of files) {
    if (!inside(projectRoot, path) || !path.includes(`${sep}node_modules${sep}`))
      throw new Error("native_pdf_trace_outside_dependencies");
    if ((await lstat(path)).isSymbolicLink()) {
      if (!inside(projectRoot, await realpath(path)))
        throw new Error("native_pdf_trace_link_outside_dependencies");
      links.push(path);
    }
  }
  for (const path of files)
    if (links.some((link) => path !== link && inside(link, path)))
      throw new Error("native_pdf_trace_symlink_children");
  if (!files.has(dirname(ownCanvasEntry))) {
    // A non-symlink node_modules installation needs no link entry; pnpm does.
    const ownDirectory = dirname(ownCanvasEntry);
    if ((await lstat(ownDirectory)).isSymbolicLink())
      throw new Error("native_pdf_trace_dependency_link_missing");
  }
  if (![...files].some((path) => path.endsWith(".node")))
    throw new Error("native_pdf_trace_platform_binary_missing");
  // PERF-01: next.config ships the PDF.js worker only with the functions that read or render PDFs.
  // Loading PDF metadata alone (any route importing the source module) does not need Canvas.
  const pdfWorker = await realpath(join(dirname(pdfMetadata), "legacy/build/pdf.worker.mjs"));
  return { projectRoot, pdfMetadata, pdfWorker, files };
}

async function manifests(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await manifests(path)));
    else if (entry.isFile() && entry.name.endsWith(".nft.json")) result.push(path);
  }
  return result;
}

export async function extendNativeDependencyTraces(serverDirectory, native) {
  let updated = 0;
  for (const path of await manifests(serverDirectory)) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.files))
      throw new Error("native_pdf_trace_manifest_invalid");
    const base = dirname(path);
    // Only extend the PDF processing traces: those next.config gives the installed PDF.js worker.
    if (!manifest.files.some((name) => resolve(base, name) === native.pdfWorker)) continue;
    const files = new Set(manifest.files);
    for (const dependency of native.files)
      files.add(relative(base, dependency).split(sep).join("/"));
    manifest.files = [...files].sort();
    await writeFile(path, `${JSON.stringify(manifest)}\n`);
    updated += 1;
  }
  if (!updated) throw new Error("native_pdf_trace_no_renderer_manifests");
  return { manifests: updated, dependencies: native.files.size };
}

export async function traceNativeDependencies(appRoot) {
  const native = await collectPdfNativeDependencies(appRoot);
  return extendNativeDependencyTraces(join(appRoot, ".next/server"), native);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify({ nativeDependencyTrace: await traceNativeDependencies(appRoot) }));
}
