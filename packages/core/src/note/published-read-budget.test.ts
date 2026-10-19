import { randomUUID } from "node:crypto";
import type { CompiledQuery } from "kysely";
import { describe, expect, it } from "vitest";
import { statementLogDatabase } from "../../test/statement-log";
import { publishedNotebookSessionIds } from "./notebooks";

// PERF-04: Today learns which classes have published notes in a fixed number of owner-scoped
// queries, as hasPublishedNotebook decides it for one class.
const ctx = { userId: randomUUID(), requestId: "published-read-budget" };
const from = (query: CompiledQuery, table: string) =>
  query.sql.includes(`from "${table.split(".").join('"."')}"`);

describe("published notebook read budget (PERF-04)", () => {
  it("decides which classes have published notes in three queries", async () => {
    const [published, stale, none] = Array.from({ length: 3 }, () => randomUUID());
    const [current, old] = [randomUUID(), randomUUID()];
    const { db, statements } = statementLogDatabase((query) => {
      if (from(query, "note.notebook"))
        return [
          { session_id: published, knowledge_version_id: current },
          { session_id: stale, knowledge_version_id: old },
        ];
      if (from(query, "org.class_session")) return [{ id: published }, { id: stale }, { id: none }];
      if (from(query, "lkm.knowledge_version"))
        return [{ id: current, session_id: published, version: 2 }];
      return [];
    });
    const ready = await publishedNotebookSessionIds(db, ctx, [published, stale, none] as string[]);
    expect(statements).toHaveLength(3);
    expect([...ready]).toEqual([published]);
  });
});
