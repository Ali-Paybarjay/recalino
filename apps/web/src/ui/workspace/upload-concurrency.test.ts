import { expect, it } from "vitest";
import { concurrentUploads } from "./upload-concurrency";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("bounds simultaneous transfers while scheduling every part once", async () => {
  const gate = deferred();
  let active = 0,
    maximum = 0;
  const started: number[] = [];
  const run = concurrentUploads([0, 1, 2, 3], 2, async (part) => {
    started.push(part);
    active++;
    maximum = Math.max(maximum, active);
    if (part < 2) await gate.promise;
    active--;
  });
  expect(started).toEqual([0, 1]);
  gate.resolve();
  await run;
  expect(started).toEqual([0, 1, 2, 3]);
  expect(maximum).toBe(2);
});
it("waits for in-flight siblings after failure and leaves later parts for retry", async () => {
  const gate = deferred();
  const failure = new Error("transfer failed");
  const started: number[] = [];
  let settled = false;
  const run = concurrentUploads([0, 1, 2], 2, async (part) => {
    started.push(part);
    if (part === 0) throw failure;
    await gate.promise;
  });
  const observed = run.catch((error) => {
    settled = true;
    return error;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(started).toEqual([0, 1]);
  gate.resolve();
  expect(await observed).toBe(failure);
  expect(started).toEqual([0, 1]);
});
it.each([0, -1, 1.5, Number.NaN])(
  "rejects invalid concurrency %s before dispatch",
  async (limit) => {
    let calls = 0;
    await expect(
      concurrentUploads([1], limit, async () => {
        calls++;
      }),
    ).rejects.toThrow("Invalid upload concurrency");
    expect(calls).toBe(0);
  },
);
