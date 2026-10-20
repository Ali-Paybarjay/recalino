import { randomUUID } from "node:crypto";
import type { CompiledQuery } from "kysely";
import { describe, expect, it } from "vitest";
import { statementLogDatabase } from "../../test/statement-log";
import { publishedNotebookSessionIds } from "./notebooks";

// PERF-04: Today learns which classes have published notes in a fixed number of owner-scoped
// queries, as hasPublishedNotebook decides it for one class the caller found live.
const ctx = { userId: randomUUID(), requestId: "published-read-budget" };
const from = (query: CompiledQuery, table: string) =>
  query.sql.includes(`from "${table.split(".").join('"."')}"`);

describe("published notebook read budget (PERF-04)", () => {
  it("decides which live classes have published notes in two queries", async () => {
    const [published, stale, moved, none] = Array.from({ length: 4 }, () => randomUUID());
    const [current, old, elsewhere] = [randomUUID(), randomUUID(), randomUUID()];
    const { db, statements } = statementLogDatabase((query) => {
      if (from(query, "note.notebook"))
        return [
          { session_id: published, knowledge_version_id: current },
          { session_id: stale, knowledge_version_id: old },
          { session_id: moved, knowledge_version_id: elsewhere },
        ];
      // Owned versions that are not tombstoned; `old` is tombstoned, `elsewhere` is another class's.
      if (from(query, "lkm.knowledge_version"))
        return [
          { id: current, session_id: published },
          { id: elsewhere, session_id: published },
        ];
      return [];
    });
    const ready = await publishedNotebookSessionIds(db, ctx, [
      published,
      stale,
      moved,
      none,
    ] as string[]);
    expect(statements).toHaveLength(2);
    // The caller found the classes live, so they are not read again.
    expect(statements.some((query) => from(query, "org.class_session"))).toBe(false);
    const [notebooks, versions] = statements;
    expect(notebooks?.parameters).toEqual(expect.arrayContaining([ctx.userId]));
    expect(versions?.sql).toContain('"user_id" = $');
    expect(versions?.sql).toContain('"tombstoned_at" is null');
    expect(versions?.parameters).toEqual(
      expect.arrayContaining([ctx.userId, current, old, elsewhere]),
    );
    expect([...ready]).toEqual([published]);
  });

  it("reads no versions when no class has a notebook", async () => {
    const { db, statements } = statementLogDatabase();
    expect([...(await publishedNotebookSessionIds(db, ctx, [randomUUID()]))]).toEqual([]);
    expect(statements).toHaveLength(1);
    const none = statementLogDatabase();
    await publishedNotebookSessionIds(none.db, ctx, []);
    expect(none.statements).toHaveLength(0);
  });
});
