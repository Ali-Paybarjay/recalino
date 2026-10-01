// Run after `pnpm build`: fails when anything secret is in the client-visible build output.
import { existsSync } from "node:fs";
import { scanBuild } from "./scan.ts";

const NEXT_DIR = "apps/web/.next";

if (!existsSync(NEXT_DIR)) {
  console.error(`No build found at ${NEXT_DIR}. Run "pnpm build" first.`);
  process.exit(1);
}

const findings = scanBuild(NEXT_DIR, ".env.example");
if (findings.length > 0) {
  for (const finding of findings) console.error(`secret leak: ${finding.match} in ${finding.file}`);
  process.exit(1);
}
console.log("No secrets in the client-visible build output.");
