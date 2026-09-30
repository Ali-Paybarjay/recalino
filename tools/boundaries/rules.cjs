// Builds dependency-cruiser rules from the approved capability map, so the document and the
// check read from one source (docs/MVP_FUNCTIONAL_REQUIREMENTS_FA.md §3.1, PROJECT_SPEC §5).
const map = require("../capability-map.json");

const modules = Object.keys(map.modules);

/** Every module `name` may import: its direct dependencies and theirs, transitively. */
function allowedModules(name) {
  const direct = map.modules[name];
  if (direct.includes("*")) return new Set(modules.filter((other) => other !== name));
  const allowed = new Set();
  const visit = (current) => {
    for (const dep of map.modules[current]) {
      if (!allowed.has(dep)) {
        allowed.add(dep);
        visit(dep);
      }
    }
  };
  visit(name);
  return allowed;
}

/** Rules for module folders under `root`, e.g. "packages/core/src". */
function capabilityMapRules(root) {
  const rules = [];
  for (const name of modules) {
    const allowed = allowedModules(name);
    const forbidden = modules.filter((other) => other !== name && !allowed.has(other));
    if (forbidden.length === 0) continue;
    rules.push({
      name: `capability-map-${name}`,
      comment: `${name} may depend only on: ${[...allowed].join(", ") || "no other module"}`,
      severity: "error",
      from: { path: `^${root}/${name}/` },
      to: { path: `^${root}/(${forbidden.join("|")})/` },
    });
  }
  rules.push({
    name: "module-public-api",
    comment: "Import another module or shared folder only through its index.ts",
    severity: "error",
    from: { path: `^${root}/([^/]+)/` },
    to: { path: `^${root}/[^/]+/`, pathNot: [`^${root}/$1/`, `^${root}/[^/]+/index.ts$`] },
  });
  rules.push({
    name: "shared-does-not-import-modules",
    comment: `Shared folders (${map.shared.join(", ")}) must not depend on modules`,
    severity: "error",
    from: { path: `^${root}/(${map.shared.join("|")})/` },
    to: { path: `^${root}/(${modules.join("|")})/` },
  });
  return rules;
}

module.exports = { allowedModules, capabilityMapRules };
