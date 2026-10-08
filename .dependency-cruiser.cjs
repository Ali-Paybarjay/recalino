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
    {
      name: "storage-sdk-behind-the-layer",
      comment:
        "Only the storage layer's Vercel Blob implementation may import its SDK (FR-PLT-014)",
      severity: "error",
      from: { pathNot: "^packages/core/src/plt/storage-vercel-blob[.]ts$" },
      to: { path: "node_modules/.*@vercel/blob/" },
    },
    ...capabilityMapRules("packages/core/src"),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      // Build output, test artefacts, the deliberate-violation fixture and Next.js's generated types.
      // node_modules is only not followed (above), not excluded: rules about packages need the edges.
      path: "(^|/)(\\.next|coverage|test-results|playwright-report)/|^tools/boundaries/fixture/|(^|/)next-env\\.d\\.ts$",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
