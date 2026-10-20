import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("./models/", import.meta.url));
// Verified downloads, named by SHA-256, so a later build in the same checkout needs no network.
const defaultCache = fileURLToPath(
  new URL("../../node_modules/.cache/recalino-voice/", import.meta.url),
);
// OPS-06: one attempt may take two minutes; three attempts, waiting 2 s and then 4 s between them.
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const DOWNLOAD_ATTEMPTS = 3;
export const DOWNLOAD_BACKOFF_MS = 2_000;
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
const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

/** The bytes of `url`, or an Error whose message is one fixed code and never includes the URL. */
async function download(url, options) {
  const {
    fetchImpl = fetch,
    timeoutMs = DOWNLOAD_TIMEOUT_MS,
    attempts = DOWNLOAD_ATTEMPTS,
    backoffMs = DOWNLOAD_BACKOFF_MS,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    log = console.warn,
  } = options;
  let failure = "model_download_network_error";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    try {
      // The signal covers the headers and the body, so a stalled transfer ends too.
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = `model_download_http_${response.status}`;
      // A missing or forbidden file will not appear on the next try; a busy host may recover.
      retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      failure = isTimeout(error) ? "model_download_timeout" : "model_download_network_error";
    }
    if (!retryable || attempt === attempts) break;
    log(JSON.stringify({ voiceModelDownload: "retry", attempt, reason: failure }));
    await sleep(backoffMs * 2 ** (attempt - 1));
  }
  throw new Error(failure);
}
async function copyVerified(from, to, sha256) {
  if (!(await validModel(from, sha256))) return false;
  const temporary = `${to}.download`;
  await copyFile(from, temporary);
  await rename(temporary, to);
  return true;
}
export async function fetchPinned(url, path, sha256, options = {}) {
  if (await validModel(path, sha256)) return;
  const cached = options.cacheDirectory ? join(options.cacheDirectory, sha256) : undefined;
  if (cached) {
    try {
      // Re-hashed on every use: a damaged or replaced cache entry is ignored, never trusted.
      if (await copyVerified(cached, path, sha256)) return;
    } catch {
      /* An unreadable cache is a cache miss. */
    }
  }
  const bytes = await download(url, options);
  if (digest(bytes) !== sha256) throw new Error("model_download_integrity_mismatch");
  const temporary = `${path}.download`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
  if (cached) {
    try {
      await mkdir(options.cacheDirectory, { recursive: true });
      await copyVerified(path, cached, sha256);
    } catch {
      /* The cache only saves time; a build never fails because it could not be written. */
    }
  }
}
export async function provisionVoiceModels(root = defaultRoot, options = {}) {
  // Only the real model directory shares the build cache; a scratch root stays self-contained.
  const downloadOptions = {
    ...options,
    cacheDirectory: options.cacheDirectory ?? (root === defaultRoot ? defaultCache : undefined),
  };
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
    await fetchPinned(
      manifest.segmentation.url,
      archive,
      manifest.segmentation.archiveSha256,
      downloadOptions,
    );
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
    downloadOptions,
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
