import { beforeEach, expect, it, vi } from "vitest";
import { queryBudgetDatabase as database } from "../../test/query-budget";
import type { RunSnapshot } from "./contracts";
import {
  findProcessingRunByOperationKey,
  getProcessingRunSnapshot,
  getRun,
  listRuns,
  runView,
} from "./runs";

const gates = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../org", async (original) => ({
  ...(await original<object>()),
  getSession: gates.session,
}));

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const ctx = { userId: USER, requestId: "synthetic-read-budget" };
const snapshot: RunSnapshot = {
  sourcesVersion: 1,
  fingerprint: "stored-input",
  sources: [
    {
      sourceId: RUN,
      kind: "text",
      sha256: "a".repeat(64),
      mimeType: "text/plain",
      durationMs: null,
      pageCount: null,
      objectId: null,
      contentVersionId: RUN,
      ranges: [],
      captureAnchor: null,
      units: [],
      blocks: [
        { id: "text", unitId: "doc", kind: "paragraph", text: "Synthetic text ".repeat(5_000) },
      ],
    },
  ],
};
function row(inputSnapshot: Parameters<typeof runView>[0]["input_snapshot"]) {
  return {
    id: RUN,
    user_id: USER,
    session_id: SESSION,
    state: "ready",
    reservation_id: RUN,
    sources_version: 1,
    last_error: null,
    output_version_id: RUN,
    created_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    input_snapshot: inputSnapshot,
  };
}

beforeEach(() => {
  gates.session.mockReset().mockResolvedValue({ id: SESSION });
});

it("PRD-PROC-03: selection identity survives removal of extraction text from a status read", () => {
  const compact = {
    ...snapshot,
    sources: snapshot.sources.map((source) => ({ ...source, blocks: [], units: [] })),
  };
  expect(runView(row(compact))).toEqual(runView(row(snapshot)));
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(snapshot).length / 100);
});

it.each(["get", "list", "acknowledgement"])(
  "PRD-PROC-03: %s selects owned status metadata and compacts content inside Postgres",
  async (mode) => {
    const { db, queries } = database([[row({})]]);
    try {
      if (mode === "get") await getRun(db, ctx, RUN);
      else if (mode === "list") await listRuns(db, ctx, SESSION);
      else await findProcessingRunByOperationKey(db, ctx, SESSION, "operation-key");
      expect(queries).toHaveLength(1);
      expect(queries[0]?.sql).not.toMatch(/select\s+\*/i);
      expect(queries[0]?.sql).toContain("jsonb_array_elements");
      expect(queries[0]?.sql).toContain("'units', '[]'::jsonb, 'blocks', '[]'::jsonb");
      expect(queries[0]?.sql).not.toContain('"settings"');
      expect(queries[0]?.sql).toContain('"user_id" =');
      expect(queries[0]?.parameters).toContain(USER);
      expect(gates.session).toHaveBeenCalledWith(db, ctx, SESSION);
    } finally {
      await db.destroy();
    }
  },
);

it("PRD-PROC-03: resumable uploads still receive the complete immutable source snapshot", async () => {
  const { db, queries } = database([[row(snapshot)]]);
  try {
    expect(await getProcessingRunSnapshot(db, ctx, RUN)).toEqual(snapshot);
    expect(queries[0]?.sql).toMatch(/select\s+\*/i);
    expect(queries[0]?.sql).not.toContain("jsonb_array_elements");
  } finally {
    await db.destroy();
  }
});

it("FR-PLT-002: a missing or unowned run returns no status", async () => {
  const { db } = database([[]]);
  try {
    await expect(getRun(db, ctx, RUN)).rejects.toMatchObject({ code: "not_found" });
    expect(gates.session).not.toHaveBeenCalled();
  } finally {
    await db.destroy();
  }
});
