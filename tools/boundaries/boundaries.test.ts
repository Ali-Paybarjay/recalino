import { createRequire } from "node:module";
import { cruise } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { allowedModules, capabilityMapRules } = require("./rules.cjs") as {
  allowedModules: (name: string) => Set<string>;
  capabilityMapRules: (root: string) => unknown[];
};

const FIXTURE_ROOT = "tools/boundaries/fixture/src";

describe("capability map boundaries (PROJECT_SPEC §10.4)", () => {
  it("allows transitive dependencies and nothing above them", () => {
    expect([...allowedModules("src")].sort()).toEqual(["acc", "org", "plt", "quota"]);
    expect(allowedModules("acc").has("proc")).toBe(false);
    expect(allowedModules("priv").has("srs")).toBe(true);
  });

  it("fails an import against the map and passes one that follows it", async () => {
    const result = await cruise([FIXTURE_ROOT], {
      ruleSet: { forbidden: capabilityMapRules(FIXTURE_ROOT) },
      tsPreCompilationDeps: true,
      validate: true,
    } as Parameters<typeof cruise>[1]);

    const output = result.output as {
      summary: { violations: { rule: { name: string }; from: string; to: string }[] };
    };
    const violations = output.summary.violations.map((v) => `${v.rule.name}: ${v.from}`);
    expect(violations).toEqual([`capability-map-acc: ${FIXTURE_ROOT}/acc/upward.ts`]);
  });
});
