import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { replayDeletionJournals } from "./recovery";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

it("refuses journal replay against the ordinary application database before invoking any hooks", async () => {
  let calls = 0;
  await expect(
    replayDeletionJournals(
      db,
      [],
      {
        hooks: [
          {
            module: "synthetic_guard",
            async tombstoneSession() {
              calls++;
            },
            async cleanupSession() {
              calls++;
            },
            async cleanupAccount() {
              calls++;
            },
          },
        ],
      },
      { disposableLocal: true },
    ),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { recovery: ["disposable_local_required"] } },
  });
  expect(calls).toBe(0);
});
