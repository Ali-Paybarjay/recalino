import { beforeEach, expect, it, vi } from "vitest";
import { queryBudgetDatabase as database } from "../../test/query-budget";
import { hasPublishedNotebook } from "./notebooks";

const gates = vi.hoisted(() => ({ session: vi.fn(), references: vi.fn() }));
vi.mock("../org", async (original) => ({
  ...(await original<object>()),
  getSession: gates.session,
}));
vi.mock("../lkm", async (original) => ({
  ...(await original<object>()),
  listAvailableKnowledgeReferences: gates.references,
}));

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const ctx = { userId: USER, requestId: "synthetic-note-budget" };
beforeEach(() => {
  gates.session.mockReset().mockResolvedValue({ id: SESSION });
  gates.references.mockReset().mockResolvedValue([{ id: VERSION, sessionId: SESSION }]);
});

it("PRD-CORE-05: readiness reads publication references without loading lesson or edits", async () => {
  const { db, queries } = database([[{ knowledge_version_id: VERSION }]]);
  try {
    expect(await hasPublishedNotebook(db, ctx, SESSION)).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('"revision"."knowledge_version_id"');
    expect(queries[0]?.sql).not.toMatch(/select\s+\*|"model"|"edits"/i);
    expect(queries[0]?.parameters).toEqual([SESSION, USER, USER]);
    expect(gates.references).toHaveBeenCalledWith(db, ctx, [SESSION]);
  } finally {
    await db.destroy();
  }
});

it.each([{ references: [] }, { references: [{ id: VERSION, sessionId: "another-session" }] }])(
  "PRD-CORE-05: deleted or mismatched knowledge cannot become ready: %j",
  async ({ references }) => {
    gates.references.mockResolvedValue(references);
    const { db } = database([[{ knowledge_version_id: VERSION }]]);
    try {
      expect(await hasPublishedNotebook(db, ctx, SESSION)).toBe(false);
    } finally {
      await db.destroy();
    }
  },
);

it("PRD-CORE-05: unpublished notes avoid even the knowledge lookup", async () => {
  const { db } = database([[]]);
  try {
    expect(await hasPublishedNotebook(db, ctx, SESSION)).toBe(false);
    expect(gates.references).not.toHaveBeenCalled();
  } finally {
    await db.destroy();
  }
});
