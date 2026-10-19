import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { listHtmlExports } from "./exports";

// PERF-04: listing a session's HTML exports checks every export's notes revision in a constant
// number of owner-scoped reads, not one chain of reads per export.
const ctx = { userId: randomUUID(), requestId: "export-list-read-budget" };
const sessionId = randomUUID();
const now = new Date("2026-10-19T12:00:00Z");

function exportRow(snapshot: unknown) {
  return {
    id: randomUUID(),
    user_id: ctx.userId,
    session_id: sessionId,
    state: "ready",
    estimated_bytes: "100",
    actual_bytes: "90",
    sha256: "0".repeat(64),
    created_at: new Date("2026-10-19T11:00:00Z"),
    expires_at: new Date("2026-10-20T11:00:00Z"),
    last_error: null,
    tombstoned_at: null,
    snapshot,
  };
}

describe("HTML export listing read budget (PERF-04)", () => {
  it("lists four HTML exports in five queries, hiding one whose notes revision is gone", async () => {
    const revisions = Array.from({ length: 4 }, () => randomUUID());
    const versions = revisions.map(() => randomUUID());
    const rows = revisions.map((revisionId) => exportRow({ revisionId }));
    const { db, queries } = queryBudgetDatabase([
      rows,
      revisions
        .slice(1)
        .map((id, index) => ({ id, versionId: versions[index + 1], sessionId: sessionId })),
      versions.slice(1).map((id) => ({ id, session_id: sessionId })),
      [{ id: sessionId }],
      [{ id: sessionId }],
    ]);
    const listed = await listHtmlExports(db, ctx, sessionId, now);
    expect(queries).toHaveLength(5);
    expect(queries[1]?.sql).toContain('from "note"."revision"');
    expect(queries[2]?.sql).toContain('from "lkm"."knowledge_version"');
    expect(listed.map((item) => item.id)).toEqual(rows.slice(1).map((row) => row.id));
  });
});
