import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// PERF-01: learner pages and the review API never reach a native processing runtime. Webpack
// traces every chunk a route references, dynamic imports included, so any import edge counts.
const web = resolve(import.meta.dirname, "../..");
const repo = resolve(web, "../..");
const coreExports: Record<string, string> = JSON.parse(
  readFileSync(join(repo, "packages/core/package.json"), "utf8"),
).exports;
const NATIVE = ["ffmpeg-static", "@napi-rs/canvas", "sherpa-onnx-node", "voice-engine-worker"];
// The PDF renderer and verifier load PDF.js (and through it Canvas) only inside a function body.
const PDFJS = "pdfjs-dist";

function file(base: string): string | null {
  for (const suffix of ["", ".ts", ".tsx", ".mjs", "/index.ts", "/index.tsx"]) {
    const path = base + suffix;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

/** Runtime import edges: static and dynamic imports, re-exports and worker URLs, not types. */
function edges(path: string): { specifier: string; topLevel: boolean }[] {
  const source = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const found: { specifier: string; topLevel: boolean }[] = [];
  const pattern =
    /^(?:import|export)\s+(type\s)?(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|new URL\(\s*["']([^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    const specifier = match[2] ?? match[3] ?? match[4];
    if (specifier) found.push({ specifier, topLevel: match[2] !== undefined });
  }
  return found;
}

function target(from: string, specifier: string): string | null {
  if (specifier.startsWith(".")) return file(resolve(dirname(from), specifier));
  if (specifier.startsWith("@recalino/core/")) {
    const entry = coreExports[`./${specifier.slice("@recalino/core/".length)}`];
    return entry ? resolve(repo, "packages/core", entry) : null;
  }
  return null;
}

/** The first chain from an entry to a native runtime (or to a top-level PDF.js import). */
function nativeChain(entry: string): string[] | null {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const chain = (from: string, native: string) => {
    const path = [native];
    for (let at: string | null | undefined = from; at; at = parent.get(at))
      path.unshift(relative(repo, at));
    return path;
  };
  while (queue.length) {
    const from = queue.shift() as string;
    for (const { specifier, topLevel } of edges(from)) {
      if (NATIVE.some((name) => specifier.includes(name))) return chain(from, specifier);
      if (topLevel && specifier.startsWith(PDFJS)) return chain(from, specifier);
      const next = target(from, specifier);
      if (next && !parent.has(next)) {
        parent.set(next, from);
        queue.push(next);
      }
    }
  }
  return null;
}

function entries(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entries(path);
    return /^(page|layout|loading|error|route)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("native processing runtime boundary (PERF-01)", () => {
  const app = join(web, "src/app");
  const learner = [
    join(app, "layout.tsx"),
    ...entries(join(app, "(app)")),
    ...entries(join(app, "api/review")),
  ];

  it("covers the learner pages and the review API", () => {
    expect(learner.map((path) => relative(app, path))).toEqual(
      expect.arrayContaining(["(app)/layout.tsx", "(app)/today/page.tsx", "api/review/route.ts"]),
    );
  });

  it.each(learner.map((path) => [relative(app, path), path]))(
    "%s reaches no native processing runtime",
    (_, path) => {
      expect(nativeChain(path)).toBeNull();
    },
  );

  it("the job runner still reaches every native runtime", () => {
    const chain = nativeChain(join(app, "api/jobs/run/route.ts"));
    expect(chain).not.toBeNull();
  });
});
