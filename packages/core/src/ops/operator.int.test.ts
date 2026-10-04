import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { CURRENT_VERSIONS, completeSignIn, createSignupIntent } from "../acc";
import { createDatabase } from "../db";
import { allowance } from "../quota";
import { executeOperatorRequest } from "./operator";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
it("runs profile-free audited quota commands, replays financial mutations once and reports metadata only", async () => {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const common = {
    version: "1",
    actorId: "synthetic-profile-free-operator",
    reason: "Synthetic operator smoke test",
    operationKey: randomUUID(),
  };
  const grant = {
    ...common,
    command: "quota.grant",
    input: {
      userId,
      startsAt: new Date(now.getTime() - 1000).toISOString(),
      endsAt: new Date(now.getTime() + 3600000).toISOString(),
      amounts: { audio: 0, document: 15, regeneration: 0, tts: 0, storage: 0 },
    },
  };
  const first = (await executeOperatorRequest(db, grant, now)) as { entitlementId: string };
  expect(await executeOperatorRequest(db, grant, now)).toEqual(first);
  const adjust = {
    ...common,
    operationKey: randomUUID(),
    command: "quota.adjust",
    input: { userId, entitlementId: first.entitlementId, dimension: "document", delta: -5 },
  };
  await executeOperatorRequest(db, adjust, now);
  await executeOperatorRequest(db, adjust, now);
  expect((await allowance(db, { userId, requestId: randomUUID() }, now)).remaining.document).toBe(
    10,
  );
  const summary = await executeOperatorRequest(
    db,
    {
      ...common,
      operationKey: randomUUID(),
      command: "stats",
      input: { since: new Date(now.getTime() - 3600000).toISOString() },
    },
    now,
  );
  const serialized = JSON.stringify(summary);
  expect(serialized).toContain("providerAttempts");
  expect(serialized).not.toContain(userId);
  expect(serialized).not.toContain("input_snapshot");
  expect(serialized).not.toContain("password");
  await executeOperatorRequest(
    db,
    {
      ...common,
      operationKey: randomUUID(),
      command: "quota.close",
      input: { userId, entitlementId: first.entitlementId },
    },
    now,
  );
  expect((await allowance(db, { userId, requestId: randomUUID() }, now)).entitlementId).toBeNull();
});
