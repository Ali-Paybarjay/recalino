const { capabilityMapRules } = require("./tools/boundaries/rules.cjs");

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "core-is-framework-free",
      comment: "packages/core holds domain logic only; no Next.js or React (PROJECT_SPEC §5)",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "(^|/)node_modules/(next|react|react-dom)/" },
    },
    ...capabilityMapRules("packages/core/src"),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      // Build output, test artefacts, the deliberate-violation fixture and Next.js's generated types.
      path: "(^|/)(node_modules|\\.next|coverage|test-results|playwright-report)/|^tools/boundaries/fixture/|(^|/)next-env\\.d\\.ts$",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
