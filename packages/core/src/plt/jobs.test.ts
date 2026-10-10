import { afterEach, expect, it, vi } from "vitest";
import { keepRenewing } from "./jobs";

afterEach(() => {
  vi.useRealTimers();
});

it("FR-PLT-005 rule 5: a renewal that never settles does not stop the next one", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const renew = vi
    .fn<() => Promise<boolean>>()
    // A query on a connection that never answers.
    .mockImplementationOnce(() => new Promise<boolean>(() => {}))
    .mockImplementation(async () => true);
  const stop = keepRenewing(renew, 1000, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(800);
  expect(events).toEqual(["job_lease_renewal_timeout"]);
  await vi.advanceTimersByTimeAsync(200);
  expect(renew).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(3);
  await stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(renew).toHaveBeenCalledTimes(3);
  expect(events).toEqual(["job_lease_renewal_timeout"]);
});

it("FR-PLT-005 rule 5: at most two unsettled renewals hold pool connections at once", async () => {
  vi.useFakeTimers();
  const hung: Array<(renewed: boolean) => void> = [];
  const renew = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        hung.push(resolve);
      }),
  );
  const stop = keepRenewing(renew, 1000, () => {});
  await vi.advanceTimersByTimeAsync(10_000);
  expect(renew).toHaveBeenCalledTimes(2);
  // Once one of them answers, renewing goes on.
  hung[0]?.(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(3);
  for (const answer of hung) answer(true);
  await stop();
});

it("FR-PLT-005 rule 5: stopping waits for a renewal in flight only up to its bound", async () => {
  vi.useFakeTimers();
  const stop = keepRenewing(
    () => new Promise<boolean>(() => {}),
    1000,
    () => {},
  );
  await vi.advanceTimersByTimeAsync(1000);
  let stopped = false;
  const stopping = stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(799);
  expect(stopped).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await stopping;
  expect(stopped).toBe(true);
});

it("FR-PLT-005 rule 5: a lost claim stops further renewals", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const renew = vi.fn(async () => false);
  const stop = keepRenewing(renew, 1000, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(3000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["job_lease_lost"]);
  await stop();
});
