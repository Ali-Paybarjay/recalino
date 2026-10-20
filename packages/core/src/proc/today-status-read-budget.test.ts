import { randomUUID } from "node:crypto";
import type { CompiledQuery } from "kysely";
import { describe, expect, it } from "vitest";
import { statementLogDatabase } from "../../test/statement-log";
import type { AutomaticLearningSession } from "./automatic-state";
import { readClassProcessingReviews } from "./processing-review";
import { runFinishingStages } from "./run-stage";
import { listClassRunsBySession, type ProcessingRun } from "./runs";

// PERF-04: the reads behind Today's statuses take a fixed number of owner-scoped queries for any
// number of classes, and answer as each class's own read does.
const ctx = { userId: randomUUID(), requestId: "today-status-read-budget" };
const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute));

function runRow(sessionId: string, state: string, minute: number, position: number) {
  return {
    id: randomUUID(),
    session_id: sessionId,
    user_id: ctx.userId,
    state,
    reservation_id: randomUUID(),
    sources_version: 1,
    last_error: state === "failed" ? "provider_http_500" : null,
    output_version_id: state === "ready" ? randomUUID() : null,
    created_at: at(minute),
    updated_at: at(minute),
    input_snapshot: {},
    position,
  };
}
const run = (sessionId: string, state: ProcessingRun["state"], minute = 0): ProcessingRun => ({
  id: randomUUID(),
  sessionId,
  state,
  reservationId: randomUUID(),
  sourcesVersion: 1,
  lastError: state === "failed" ? "provider_http_500" : null,
  outputVersionId: state === "ready" ? randomUUID() : null,
  createdAt: at(minute).toISOString(),
  updatedAt: at(minute).toISOString(),
});
const intent = (
  sessionId: string,
  state: AutomaticLearningSession["state"],
  runId: string | null,
) =>
  ({
    sessionId,
    userId: ctx.userId,
    requestVersion: 1,
    requestedVersion: 1,
    requestedAt: at(0).toISOString(),
    batchId: null,
    lastBatchId: null,
    batchStartedAt: null,
    batchFiles: null,
    state,
    lastError: state === "blocked" ? "provider_http_500" : null,
    runId,
    updatedAt: at(0).toISOString(),
    enabledAt: at(0).toISOString(),
  }) satisfies AutomaticLearningSession;
const from = (query: CompiledQuery, table: string) =>
  query.sql.includes(`from "${table.split(".").join('"."')}"`);

describe("Today status read budget (PERF-04)", () => {
  it.each([3, 10])(
    "lists the newest class runs of %i classes in one ranked query",
    async (count) => {
      const sessions = Array.from({ length: count }, () => randomUUID());
      const rows = sessions.flatMap((sessionId, index) =>
        index % 2 ? [] : [runRow(sessionId, "ready", 2, 1), runRow(sessionId, "failed", 1, 2)],
      );
      const { db, statements } = statementLogDatabase(() => rows);
      const runs = await listClassRunsBySession(db, ctx, sessions);
      expect(statements).toHaveLength(1);
      const text = statements[0]?.sql ?? "";
      expect(text).toContain(
        "row_number() over (partition by session_id order by created_at desc, id desc)",
      );
      expect(text).toContain('"user_id" = $1');
      expect(text).toContain('"kind" = $');
      expect(text).toContain('"position" <= $');
      expect(statements[0]?.parameters).toContain(50);
      expect([...runs.keys()]).toEqual(sessions);
      expect(runs.get(sessions[0] as string)?.map((item) => item.state)).toEqual([
        "ready",
        "failed",
      ]);
      expect(runs.get(sessions[1] as string)).toEqual([]);
    },
  );

  it("reads every class's review requests in one query and reviews each class as before", async () => {
    const [failed, requested, quiet, empty] = Array.from({ length: 4 }, () => randomUUID());
    const failedRun = run(failed as string, "failed", 3);
    const requestedRuns = [
      run(requested as string, "failed", 4),
      run(requested as string, "ready", 1),
    ];
    const quietRun = run(quiet as string, "ready", 2);
    const { db, statements } = statementLogDatabase((query) =>
      from(query, "plt.audit_event")
        ? [
            { subject_id: requestedRuns[1]?.id, occurred_at: at(9) },
            { subject_id: requestedRuns[0]?.id, occurred_at: at(8) },
          ]
        : [],
    );
    const reviews = await readClassProcessingReviews(db, ctx, {
      runs: new Map([
        [failed as string, [failedRun]],
        [requested as string, requestedRuns],
        [quiet as string, [quietRun]],
        [empty as string, []],
      ]),
      intents: new Map([
        [failed as string, intent(failed as string, "blocked", failedRun.id)],
        [quiet as string, intent(quiet as string, "ready", quietRun.id)],
      ]),
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.parameters).toEqual(
      expect.arrayContaining([ctx.userId, "processing.review_requested", "processing_run"]),
    );
    expect(reviews.get(failed as string)).toMatchObject({
      state: "not_requested",
      runId: failedRun.id,
      canRequest: true,
      errorCode: "provider_http_500",
    });
    // The newest request among the class's own runs, as latestSubjectAudit returns it.
    expect(reviews.get(requested as string)).toMatchObject({
      state: "awaiting_review",
      requestedRunId: requestedRuns[1]?.id,
      requestedAt: at(9).toISOString(),
      canRequest: true,
    });
    expect(reviews.get(quiet as string)).toBeNull();
    expect(reviews.get(empty as string)).toBeNull();
    const none = statementLogDatabase();
    await readClassProcessingReviews(none.db, ctx, { runs: new Map(), intents: new Map() });
    expect(none.statements).toHaveLength(0);
  });

  it("finds the finishing stage of processing runs in at most two queries", async () => {
    const [audio, text, waiting, other] = Array.from({ length: 4 }, () => randomUUID());
    const { db, statements } = statementLogDatabase((query) => {
      // The database answers with the owned processing runs whose lesson step is written.
      if (from(query, "proc.processing_run"))
        return [
          { id: audio, input_snapshot: { sources: [{ kind: "audio" }] } },
          { id: text, input_snapshot: { sources: [{ kind: "text" }] } },
        ];
      if (from(query, "voc.profile"))
        return [{ user_id: ctx.userId, version: 1, enabled: false, model_version: null }];
      return [];
    });
    const stages = await runFinishingStages(db, ctx, [audio, text, waiting, other] as string[]);
    expect(statements).toHaveLength(2);
    // One read of the runs and their lesson step, as runFinishingStage's two reads decide it.
    const [runs, voice] = statements;
    expect(runs?.sql).toContain('"user_id" = $');
    expect(runs?.sql).toContain('"state" = $');
    expect(runs?.sql).toContain("exists (select");
    expect(runs?.sql).toContain('from "proc"."run_step"');
    expect(runs?.parameters).toEqual(
      expect.arrayContaining([audio, text, waiting, other, ctx.userId, "processing", "knowledge"]),
    );
    expect(voice?.sql).toContain('from "voc"."profile"');
    expect(stages.get(audio as string)).toBe("publishing");
    expect(stages.get(text as string)).toBe("publishing");
    expect(stages.get(waiting as string)).toBeNull();
    expect(stages.get(other as string)).toBeNull();
    // With no lesson written, the voice enrollment is not read.
    const idle = statementLogDatabase();
    expect((await runFinishingStages(idle.db, ctx, [other as string])).get(other as string)).toBe(
      null,
    );
    expect(idle.statements).toHaveLength(1);
    const none = statementLogDatabase();
    await runFinishingStages(none.db, ctx, []);
    expect(none.statements).toHaveLength(0);
  });

  it("checks voices for an audio lesson only while voice enrollment is on", async () => {
    const [audio, text] = Array.from({ length: 2 }, () => randomUUID());
    const { db } = statementLogDatabase((query) => {
      if (from(query, "proc.processing_run"))
        return [
          { id: audio, input_snapshot: { sources: [{ kind: "audio" }] } },
          { id: text, input_snapshot: { sources: [{ kind: "text" }] } },
        ];
      if (from(query, "voc.profile"))
        return [
          { user_id: ctx.userId, version: 1, enabled: true, model_version: "m", embeddings: [] },
        ];
      return [];
    });
    const stages = await runFinishingStages(db, ctx, [audio, text] as string[]);
    expect(stages.get(audio as string)).toBe("checking_voices");
    expect(stages.get(text as string)).toBe("publishing");
  });
});
