import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { type EstimateRate, readEstimateRates, saveEstimateRates } from "./pricing";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const localAdmin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
afterAll(async () => {
  await db.destroy();
  await localAdmin.destroy();
});

function rates(rateMicros: number): EstimateRate[] {
  return [
    {
      id: "synthetic-rate",
      stage: "generation",
      model: "synthetic/rate-integration",
      unit: "input_million_tokens",
      rateMicros,
    },
  ];
}

async function removeSyntheticRevisions(operationKeys: string[]) {
  // Only these test-created revisions are removed; earlier active configuration remains intact.
  await localAdmin
    .deleteFrom("aip.estimate_rate_revision")
    .where("operation_key", "in", operationKeys)
    .execute();
}

describe("immutable estimate-rate revisions on Postgres", () => {
  it("serializes concurrent exact retries and rejects a changed payload without another revision or audit", async () => {
    const operationKey = `pricing-concurrent-${randomUUID()}`;
    const previous = await readEstimateRates(db);
    const input = {
      rates: rates(100000),
      operationKey,
      actorId: await createAuthUser(),
      reason: "Synthetic estimate-rate concurrency verification",
    };
    try {
      const saved = await Promise.all(
        Array.from({ length: 8 }, () => saveEstimateRates(db, input)),
      );
      for (const result of saved) {
        expect(result).toEqual({ version: `admin-${operationKey}`, rates: input.rates });
      }
      await expect(saveEstimateRates(db, { ...input, rates: rates(200000) })).rejects.toMatchObject(
        { code: "idempotency_mismatch" },
      );
      const revisions = await db
        .selectFrom("aip.estimate_rate_revision")
        .select(["version", "rates", "actor_id", "reason"])
        .where("operation_key", "=", operationKey)
        .execute();
      expect(revisions).toEqual([
        {
          version: `admin-${operationKey}`,
          rates: input.rates,
          actor_id: input.actorId,
          reason: input.reason,
        },
      ]);
      const audit = await db
        .selectFrom("plt.audit_event")
        .select(["action", "subject_id", "actor_id"])
        .where("request_id", "=", operationKey)
        .execute();
      expect(audit).toEqual([
        {
          action: "aip.estimate_rates",
          subject_id: `admin-${operationKey}`,
          actor_id: input.actorId,
        },
      ]);
    } finally {
      await removeSyntheticRevisions([operationKey]);
    }
    expect(await readEstimateRates(db)).toEqual(previous);
  });

  it("keeps historical retries immutable after a new schedule and denies app updates or deletion", async () => {
    const marker = randomUUID();
    const operationKeys: [string, string] = [
      `pricing-history-1-${marker}`,
      `pricing-history-2-${marker}`,
    ];
    const previous = await readEstimateRates(db);
    const actorId = await createAuthUser();
    const input = { actorId, reason: "Synthetic estimate-rate history verification" };
    try {
      const first = await saveEstimateRates(db, {
        ...input,
        operationKey: operationKeys[0],
        rates: rates(100000),
      });
      const second = await saveEstimateRates(db, {
        ...input,
        operationKey: operationKeys[1],
        rates: rates(300000),
      });
      expect(await readEstimateRates(db)).toEqual(second);
      expect(
        await saveEstimateRates(db, {
          ...input,
          operationKey: operationKeys[0],
          rates: first.rates,
        }),
      ).toEqual(first);
      await expect(
        db
          .updateTable("aip.estimate_rate_revision")
          .set({ rates: JSON.stringify(rates(999999)) })
          .where("operation_key", "=", operationKeys[0])
          .execute(),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db
          .deleteFrom("aip.estimate_rate_revision")
          .where("operation_key", "=", operationKeys[0])
          .execute(),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await readEstimateRates(db)).toEqual(second);
      const history = await db
        .selectFrom("aip.estimate_rate_revision")
        .select(["version", "rates"])
        .where("operation_key", "in", operationKeys)
        .orderBy("version")
        .execute();
      expect(history).toEqual([first, second]);
    } finally {
      await removeSyntheticRevisions(operationKeys);
    }
    expect(await readEstimateRates(db)).toEqual(previous);
  });
});
