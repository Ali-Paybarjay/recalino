import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { type AdminReadConfiguration, readAdminSnapshot } from "./admin-read";

const configuration = {} as AdminReadConfiguration;
const directory = { getUser: async () => ({ name: null, email: null, language: "en" as const }) };
const createdAt = new Date("2026-10-19T09:00:00.000Z");

// PRD-03 and the OPS-02 follow-up (D96): a stopped deletion and an open health alert are tasks.
describe("admin tasks for stopped deletions and health alerts", () => {
  it("lists them without naming an account, with the approved alert sentence", async () => {
    const requestId = randomUUID();
    const { db } = queryBudgetDatabase([
      [
        {
          id: `privacy:${requestId}`,
          kind: "privacy",
          user_id: null,
          resource_id: requestId,
          state: "needs_operator",
          created_at: createdAt,
        },
        {
          id: "health:41",
          kind: "health",
          user_id: null,
          resource_id: "runner_stale",
          state: "open",
          created_at: createdAt,
        },
        {
          id: "health:42",
          kind: "health",
          user_id: null,
          resource_id: "toString",
          state: "open",
          created_at: createdAt,
        },
      ],
    ]);
    const snapshot = await readAdminSnapshot(
      db,
      { view: "tasks", actorId: randomUUID() },
      directory,
      configuration,
    );
    const general = { en: "Review this task", fa: "بررسی این کار" };
    expect(snapshot.tasks).toEqual([
      {
        id: `privacy:${requestId}`,
        kind: "privacy",
        title: general,
        userIds: [],
        state: "needs_operator",
        createdAt: createdAt.toISOString(),
      },
      {
        id: "health:41",
        kind: "health",
        title: general,
        detail: {
          en: "The job runner has not run recently.",
          fa: "اجراکنندهٔ کارها اخیراً اجرا نشده است.",
        },
        userIds: [],
        state: "open",
        createdAt: createdAt.toISOString(),
      },
      {
        id: "health:42",
        kind: "health",
        title: general,
        userIds: [],
        state: "open",
        createdAt: createdAt.toISOString(),
      },
    ]);
  });
});
