// Run after `pnpm build` (the web build script does): fails when a traced Function is larger than
// the limit, before Vercel refuses the deployment at 250 MB. Logs the numbers as one JSON line.
//   node tools/function-size/check.ts [--dir .next/server/app] [--limit-mb 225]
import { existsSync } from "node:fs";
import { measureFunctions, optionValue, parseLimitMb, summarize } from "./scan.ts";

const argv = process.argv.slice(2);
const directory = optionValue(argv, "--dir") ?? ".next/server/app";

if (!existsSync(directory)) {
  console.error(`function_size_build_missing: no build output at ${directory}`);
  process.exit(1);
}

let summary: ReturnType<typeof summarize>;
try {
  summary = summarize(measureFunctions(directory), parseLimitMb(argv, process.env));
} catch (error) {
  console.error(error instanceof Error ? error.message : "function_size_check_failed");
  process.exit(1);
}
console.log(JSON.stringify({ functionSize: summary }));
if (summary.overLimit.length > 0) {
  for (const { manifest, mb } of summary.overLimit)
    console.error(
      `function_size_limit_exceeded: ${manifest} is ${mb} MB, limit ${summary.limitMb} MB`,
    );
  process.exit(1);
}
