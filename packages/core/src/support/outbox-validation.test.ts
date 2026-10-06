import { Kysely, PostgresDialect, type PostgresPoolClient } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "../db";
import type { OutboxRow } from "./email";
import { runEmailOutbox } from "./provider";

/** The real Kysely compiler runs against a synthetic query-only client, with no network or email. */
function database(presentation: unknown) {
  const row: OutboxRow = {
    id: "3f0d44c7-862f-4552-b138-66d5d6381db8",
    draft_id: null,
    thread_id: null,
    user_id: null,
    purpose_key: "synthetic:validation",
    template_id: "freeform",
    email: "recipient@example.invalid",
    subject: "Synthetic approval",
    body: "Synthetic approved text",
    language: "en",
    state: "sending",
    attempts: 1,
    provider_id: null,
    last_error: null,
    sent_at: null,
    created_at: new Date("2026-10-06T00:00:00Z"),
    attempted_at: new Date("2026-10-06T00:00:00Z"),
    presentation,
  };
  const query = vi.fn(async (statement: string, _parameters: readonly unknown[]) => {
    const rows = /select \* from support.email_outbox|returning \*/.test(statement) ? [row] : [];
    return { command: "SELECT" as const, rowCount: rows.length, rows };
  });
  const client = { query, release() {} } as unknown as PostgresPoolClient;
  return {
    query,
    db: new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: { options: {}, connect: async () => client, end: async () => {} },
      }),
    }),
  };
}

describe("AC-ADM-011 deterministic pre-dispatch failures", () => {
  it.each([
    { html: "<script>unapproved()</script>", text: "Malformed snapshot" },
    { designVersion: "unsupported", logoVersion: "untrusted" },
  ])(
    "records an invalid stored snapshot as failed without calling the provider: %j",
    async (value) => {
      const { db, query } = database(value);
      const send = vi.fn(async () => ({ state: "sent" as const, providerId: "synthetic" }));
      try {
        expect(await runEmailOutbox(db, { provider: { send }, limit: 1 })).toMatchObject({
          processed: 1,
          failed: 1,
          sent: 0,
          unknown: 0,
        });
        expect(send).not.toHaveBeenCalled();
        expect(
          query.mock.calls.some(([statement]) =>
            statement.includes("set state='failed',last_error='email_presentation_invalid'"),
          ),
        ).toBe(true);
      } finally {
        await db.destroy();
      }
    },
  );
  it("keeps an exception after provider dispatch unknown without retrying", async () => {
    const { db, query } = database(null);
    const send = vi.fn(async () => {
      throw new Error("Synthetic ambiguous provider result");
    });
    try {
      expect(await runEmailOutbox(db, { provider: { send }, limit: 1 })).toMatchObject({
        processed: 1,
        failed: 0,
        sent: 0,
        unknown: 1,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(
        query.mock.calls.some(
          ([, parameters]) =>
            parameters.includes("unknown") && parameters.includes("provider_result_unverified"),
        ),
      ).toBe(true);
    } finally {
      await db.destroy();
    }
  });
});
