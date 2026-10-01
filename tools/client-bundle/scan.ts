// FR-PLT-009: nothing secret may reach the browser. Scans the files a browser can download after
// `next build` for server-only variable names and well-known credential patterns.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Finding {
  file: string;
  match: string;
}

const CREDENTIAL_PATTERNS: [string, RegExp][] = [
  ["postgres connection string with a password", /postgres(?:ql)?:\/\/[^\s"'`/:@]+:[^\s"'`@]+@/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/],
  ["Vercel Blob read-write token", /vercel_blob_rw_[A-Za-z0-9_]{10,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/** Server-only variable names declared in .env.example (everything except NEXT_PUBLIC_*). */
export function serverEnvNames(envExample: string): string[] {
  return envExample
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((name): name is string => name !== undefined && !name.startsWith("NEXT_PUBLIC_"));
}

export function findSecrets(file: string, content: string, envNames: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const name of envNames) {
    if (new RegExp(`\\b${name}\\b`).test(content))
      findings.push({ file, match: `env name ${name}` });
  }
  for (const [label, pattern] of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) findings.push({ file, match: label });
  }
  return findings;
}

const SCANNED = /\.(js|mjs|css|html|rsc|json|map|txt)$/;

/** Files a browser can receive: static chunks and prerendered pages. */
export function clientVisibleFiles(nextDir: string): string[] {
  const roots = [join(nextDir, "static"), join(nextDir, "server", "app")];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        SCANNED.test(entry.name) &&
        (dir.includes("static") || !entry.name.endsWith(".js"))
      ) {
        files.push(path);
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return files;
}

export function scanBuild(nextDir: string, envExamplePath: string): Finding[] {
  const names = serverEnvNames(readFileSync(envExamplePath, "utf8"));
  return clientVisibleFiles(nextDir).flatMap((file) =>
    findSecrets(file, readFileSync(file, "utf8"), names),
  );
}
