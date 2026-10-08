import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as account from "../acc";
import * as cards from "../card";
import type { Database } from "../db";
import { errors } from "../plt";
import { getReviewQueue } from "./review";

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("finishes queued database reads before an ownership rejection lets the caller close its pool", async () => {
  const failure = errors.notFound();
  const state = deferred<unknown[]>();
  const settings = deferred<undefined>();
  const profile = deferred<Awaited<ReturnType<typeof account.getAccountState>>>();
  vi.spyOn(cards, "listCards").mockRejectedValue(failure);
  vi.spyOn(account, "getAccountState").mockReturnValue(profile.promise);
  const query = {
    selectAll() {
      return this;
    },
    where() {
      return this;
    },
    execute: () => state.promise,
    executeTakeFirst: () => settings.promise,
  };
  const db = { selectFrom: () => query } as unknown as Database;
  let settled = false;
  const result = getReviewQueue(
    db,
    { userId: randomUUID(), requestId: randomUUID() },
    { sessionId: randomUUID() },
  ).then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await new Promise<void>((done) => setImmediate(done));
  try {
    expect(settled).toBe(false);
  } finally {
    state.resolve([]);
    settings.resolve(undefined);
    profile.resolve(null);
    await result;
  }
  expect(await result).toBe(failure);
});
