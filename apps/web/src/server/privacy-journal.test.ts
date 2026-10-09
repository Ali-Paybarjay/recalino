import { randomUUID } from "node:crypto";
import { MemoryObjectStore } from "@recalino/core/plt";
import { beforeEach, expect, it, vi } from "vitest";
import { localJournalFixtureAvailable, privacyDeletionJournal } from "./privacy-journal";

const effects = vi.hoisted(() => ({ append: vi.fn(), store: vi.fn(), database: vi.fn() }));
vi.mock("@recalino/core/ops", () => ({
  appendEncryptedDeletionJournal: effects.append,
  backupEncryptionKey: vi.fn(),
}));
vi.mock("./db", () => ({ getDatabase: effects.database }));
vi.mock("./storage", () => ({ getObjectStore: effects.store }));

const local = {
  NODE_ENV: "production",
  RECALINO_DEV_UI: "1",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-local-publishable-key",
  SUPABASE_SECRET_KEY: "synthetic-local-secret-key",
  RECALINO_TEST_JOURNAL: "1",
};
const entry = {
  requestId: randomUUID(),
  userId: randomUUID(),
  kind: "account" as const,
  subjectId: randomUUID(),
  relatedSessions: [],
  requestedAt: new Date().toISOString(),
};
beforeEach(() => {
  effects.append.mockReset();
  effects.store.mockClear();
  effects.database.mockClear();
});

it.each([
  { ...local, RECALINO_TEST_JOURNAL: undefined },
  { ...local, RECALINO_TEST_JOURNAL: "true" },
  { ...local, RECALINO_DEV_UI: undefined },
  { ...local, SUPABASE_URL: "https://synthetic.supabase.co" },
  { ...local, SUPABASE_URL: "http://127.0.0.1.example.test" },
  { ...local, SUPABASE_SECRET_KEY: undefined },
  ...["production", "preview", "development", ""].map((VERCEL_ENV) => ({
    ...local,
    VERCEL_ENV,
  })),
])("the journal fixture cannot bypass missing production configuration: %j", async (env) => {
  expect(localJournalFixtureAvailable(env)).toBe(false);
  await expect(privacyDeletionJournal(env).record(entry)).rejects.toMatchObject({
    code: "internal",
    reason: "deletion_journal_key_missing",
    details: undefined,
  });
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.store).not.toHaveBeenCalled();
  expect(effects.database).not.toHaveBeenCalled();
});

it("explicit local browser fixtures use encrypted journaling with a process-only key and store", async () => {
  effects.append.mockResolvedValue({ journalId: randomUUID() });
  expect(localJournalFixtureAvailable(local)).toBe(true);
  await privacyDeletionJournal(local).record(entry);
  const call = effects.append.mock.calls[0];
  if (!call) throw new Error("Missing synthetic journal append");
  expect(call[1]).toBeInstanceOf(MemoryObjectStore);
  expect(call[2].keyId).toBe("local-e2e-fixture");
  expect(call[2].key).toBeInstanceOf(Uint8Array);
  expect(call[2].key.length).toBe(32);
  expect(call[3]).toEqual(entry);
  await privacyDeletionJournal({ ...local, SUPABASE_URL: "http://localhost:54321" }).record(entry);
  expect(effects.append.mock.calls[1]?.[1]).toBe(call[1]);
  expect(effects.append.mock.calls[1]?.[2].key).toBe(call[2].key);
  expect(effects.store).not.toHaveBeenCalled();
});
