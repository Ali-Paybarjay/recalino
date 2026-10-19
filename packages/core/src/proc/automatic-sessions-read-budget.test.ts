import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { listAutomaticLearningSessions } from "./automatic-state";

// PERF-04: Today reads the intents of its recent sessions in one owner-scoped query.
const ctx = { userId: randomUUID(), requestId: "automatic-sessions-read-budget" };

function intentRow(sessionId: string, state: string) {
  return {
    session_id: sessionId,
    user_id: ctx.userId,
    request_version: 2,
    batch_id: null,
    last_batch_id: null,
    batch_started_at: null,
    batch_manifest: null,
    state,
    last_error: null,
    run_id: null,
    updated_at: new Date(0),
    enabled_at: new Date(0),
  };
}

describe("automatic learning intents read budget (PERF-04)", () => {
  it("reads ten sessions' intents in one query limited to the learner's live sessions", async () => {
    const sessions = Array.from({ length: 10 }, () => randomUUID());
    const { db, queries } = queryBudgetDatabase([
      [intentRow(sessions[1] as string, "processing"), intentRow(sessions[4] as string, "ready")],
    ]);
    const intents = await listAutomaticLearningSessions(db, ctx, sessions);
    expect(queries).toHaveLength(1);
    const text = queries[0]?.sql ?? "";
    expect(text).toContain('from "proc"."automatic_session"');
    expect(text).toContain('from "org"."class_session"');
    expect(text).toContain('"deleted_at" is null');
    expect(text).toContain('"owner_id" = $');
    expect(queries[0]?.parameters.filter((value) => value === ctx.userId)).toHaveLength(2);
    expect(intents.get(sessions[1] as string)?.state).toBe("processing");
    expect(intents.get(sessions[4] as string)?.state).toBe("ready");
    expect(intents.has(sessions[0] as string)).toBe(false);
  });

  it("reads nothing for no sessions", async () => {
    const { db, queries } = queryBudgetDatabase([]);
    expect((await listAutomaticLearningSessions(db, ctx, [])).size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
