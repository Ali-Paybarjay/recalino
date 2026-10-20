// OPS-06: Vercel refuses a Function above 250 MB (uncompressed). The native tracers add large
// binaries to the Functions' file lists after `next build`, so a dependency upgrade can push one
// over the limit. This measures what each traced Function would ship from its `.nft.json`.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Vercel counts in mebibytes; 1 MB here is 1 048 576 bytes. */
export const MEGABYTE = 1024 * 1024;
/** Leaves 25 MB under the 250 MB platform limit for what the manifests do not list. */
export const DEFAULT_LIMIT_MB = 225;

export interface FunctionSize {
  /** The manifest path relative to the scanned directory, with forward slashes. */
  manifest: string;
  /** Bytes of the distinct files the manifest lists. */
  bytes: number;
  files: number;
  /** Listed files that were not on disk. They add no bytes. */
  missing: number;
}

/** Resolved path to its size in bytes, `null` for something that is not a file. Shared per scan. */
type SizeCache = Map<string, number | null>;

function sizeOf(path: string, cache: SizeCache): { real: string; size: number | null } | null {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return null;
  }
  if (!cache.has(real)) {
    const stat = statSync(real);
    cache.set(real, stat.isFile() ? stat.size : null);
  }
  return { real, size: cache.get(real) ?? null };
}

export function measureManifest(manifestPath: string, cache: SizeCache = new Map()): FunctionSize {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const list = (parsed as { files?: unknown } | null)?.files;
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string"))
    throw new Error("function_size_manifest_invalid");
  const base = resolve(manifestPath, "..");
  const counted = new Set<string>();
  let bytes = 0;
  let missing = 0;
  for (const entry of list as string[]) {
    const found = sizeOf(resolve(base, entry), cache);
    if (!found) missing++;
    // A symlink, a linked directory and the file itself are one file: count its real path once.
    else if (found.size !== null && !counted.has(found.real)) {
      counted.add(found.real);
      bytes += found.size;
    }
  }
  return { manifest: manifestPath, bytes, files: counted.size, missing };
}

function manifestsBelow(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...manifestsBelow(path));
    else if (entry.name.endsWith(".nft.json")) found.push(path);
  }
  return found;
}

/** Every Function manifest below `directory` (for Next: `.next/server/app`), largest first. */
export function measureFunctions(directory: string): FunctionSize[] {
  const cache: SizeCache = new Map();
  return manifestsBelow(directory)
    .map((path) => ({
      ...measureManifest(path, cache),
      manifest: relative(directory, path).split(sep).join("/"),
    }))
    .sort((left, right) => right.bytes - left.bytes);
}

const oneDecimal = (bytes: number) => Math.round((bytes / MEGABYTE) * 10) / 10;

export function summarize(sizes: FunctionSize[], limitMb: number) {
  const largest = sizes.reduce<FunctionSize | undefined>(
    (best, size) => (best && best.bytes >= size.bytes ? best : size),
    undefined,
  );
  return {
    limitMb,
    functions: sizes.length,
    largestMb: largest ? oneDecimal(largest.bytes) : 0,
    largest: largest?.manifest ?? null,
    overLimit: sizes
      .filter((size) => size.bytes > limitMb * MEGABYTE)
      .map((size) => ({ manifest: size.manifest, mb: oneDecimal(size.bytes) })),
    missingFiles: sizes.reduce((total, size) => total + size.missing, 0),
  };
}

/** The value after `--name`, or from `--name=value`; `undefined` when the flag is absent. */
export function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index === -1) return undefined;
  const arg = argv[index] as string;
  return arg.includes("=") ? arg.slice(name.length + 1) : (argv[index + 1] ?? "");
}

/** `--limit-mb`, else RECALINO_FUNCTION_SIZE_LIMIT_MB, else 225. A bad value stops the build. */
export function parseLimitMb(argv: string[], env: Record<string, string | undefined>): number {
  const raw = optionValue(argv, "--limit-mb") ?? (env.RECALINO_FUNCTION_SIZE_LIMIT_MB || undefined);
  if (raw === undefined) return DEFAULT_LIMIT_MB;
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value > 0)) throw new Error("function_size_limit_invalid");
  return value;
}
