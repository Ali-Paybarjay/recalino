import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSchemaNameViolations, readCodeFiles, tablesFromGeneratedTypes } from "./schema-names";

describe("module tables stay inside their module (ADR-0002 rule 4)", () => {
  it("reads qualified table names from the generated types", () => {
    const source = 'export interface DB {\n  "plt.audit_event": A;\n  "quota.ledger_entry": B;\n}';
    expect(tablesFromGeneratedTypes(source)).toEqual(["plt.audit_event", "quota.ledger_entry"]);
  });

  it("flags a table used outside its module and allows it inside", () => {
    const files = [
      { path: "packages/core/src/plt/security.ts", content: 'from("plt.audit_event")' },
      { path: "packages/core/src/quota/ledger.ts", content: 'from("plt.audit_event")' },
      { path: "apps/web/src/x.ts", content: "select * from plt.audit_event" },
      { path: "apps/web/src/y.ts", content: "const name = 'plt.audit_events_view';" },
      { path: "apps/web/src/dto.ts", content: "const value = plt.audit_eventId;" },
      { path: "apps/web/src/text.ts", content: "const value = 'plt-audit_event';" },
      { path: "apps/web/src/z.int.test.ts", content: 'selectFrom("plt.audit_event")' },
      { path: "apps/web/e2e/admin.spec.ts", content: 'selectFrom("plt.audit_event")' },
      { path: "packages/core/test/voice-fixture.ts", content: 'selectFrom("plt.audit_event")' },
      { path: "packages/core/src/test/helper.ts", content: 'selectFrom("plt.audit_event")' },
    ];
    expect(findSchemaNameViolations(files, ["plt.audit_event"])).toEqual([
      { path: "packages/core/src/quota/ledger.ts", table: "plt.audit_event" },
      { path: "apps/web/src/x.ts", table: "plt.audit_event" },
      { path: "packages/core/src/test/helper.ts", table: "plt.audit_event" },
    ]);
  });

  it("holds for the repository", () => {
    const tables = tablesFromGeneratedTypes(readFileSync("packages/core/src/db/types.ts", "utf8"));
    // The checker's own folder holds example table names on purpose.
    const files = readCodeFiles(process.cwd(), ["apps", "packages", "tools"]).filter(
      (file) => !file.path.startsWith("tools/boundaries/"),
    );
    expect(findSchemaNameViolations(files, tables)).toEqual([]);
  });
});
