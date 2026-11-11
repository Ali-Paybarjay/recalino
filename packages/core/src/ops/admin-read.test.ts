import { randomUUID } from "node:crypto";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { type AdminReadConfiguration, readAdminSnapshot } from "./admin-read";

const configuration = {} as AdminReadConfiguration;
const directory = { getUser: async () => ({ name: null, email: null, language: "en" as const }) };

type Attempt = { state: string; started_at: Date };

/**
 * Real Kysely compiler; a small stand-in answers each table of the costs view. The attempt
 * outcome query is answered by applying its own state filter and window to the fixture attempts.
 */
function costsDatabase(attempts: Attempt[], unknownCosts: number) {
  const answer = (query: CompiledQuery): unknown[] => {
    // Kysely quotes builder table names ("quota"."provider_cost"); raw sql keeps them bare.
    const table = (name: string) => query.sql.replaceAll('"', "").includes(name);
    if (table("quota.provider_cost"))
      return [
        {
          provider: "openai",
          model: "test-model",
          currency: "USD",
          price_version: "v1",
          count: "3",
          actual: "100",
          estimated: "50",
          unknown: String(unknownCosts),
        },
      ];
    if (table("quota.cost_hold")) return [{ currency: "USD", count: "1", maximum: "70" }];
    if (table("quota.cost_policy"))
      return [
        {
          version: "policy-1",
          currency: "USD",
          kill_switch: false,
          limits: { session: 1, userMonth: 2, systemDay: 3, systemMonth: 4 },
        },
      ];
    if (table("ops.admin_attempt_outcome")) {
      const arrays = query.parameters.filter((value) => Array.isArray(value)) as string[][];
      const states = arrays.length
        ? arrays.flat()
        : [...query.sql.matchAll(/state\s*=\s*'([a-z_]+)'/g)].map((match) => match[1]);
      const since = query.parameters.find((value) => value instanceof Date);
      if (!(since instanceof Date) || states.length === 0) throw new Error("unexpected_query");
      const count = attempts.filter(
        (attempt) => states.includes(attempt.state) && attempt.started_at >= since,
      ).length;
      return [{ count: String(count) }];
    }
    throw new Error("unexpected_query");
  };
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      return { rows: answer(query) as R[] };
    },
    async *streamQuery<R>() {
      yield { rows: [] as R[] };
    },
  };
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return connection;
    }
  }
  return new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

// C9-6 (P9-04, F-6): an attempt left in `started` has no known provider outcome; once its hold is
// closed the operator still has to see it among the unknown outcomes, like an `uncertain` one.
describe("admin costs unknown outcomes", () => {
  it("counts a started provider attempt like an uncertain one, and nothing else", async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const db = costsDatabase(
      [
        { state: "started", started_at: thisMonth },
        { state: "uncertain", started_at: thisMonth },
        { state: "succeeded", started_at: thisMonth },
        { state: "failed", started_at: thisMonth },
        { state: "started", started_at: lastMonth },
        { state: "uncertain", started_at: lastMonth },
      ],
      2,
    );
    const snapshot = await readAdminSnapshot(
      db,
      { view: "costs", actorId: randomUUID() },
      directory,
      configuration,
    );
    expect(snapshot).toEqual({
      view: "costs",
      costs: {
        actualMicros: 100,
        estimatedMicros: 50,
        reservedMicros: 70,
        // Two costs without an amount, one started and one uncertain attempt of this month.
        unknownCount: 4,
        currency: "USD",
        version: "policy-1",
        killSwitch: false,
        limits: { session: 1, userMonth: 2, systemDay: 3, systemMonth: 4 },
      },
    });
  });
});
