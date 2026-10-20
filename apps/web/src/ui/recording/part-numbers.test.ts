import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devicePartNumbers, PART_NUMBERS_PREFIX } from "./part-numbers";

const userId = "10000000-0000-4000-8000-000000000002";
const session = "20000000-0000-4000-8000-000000000001";
const key = "30000000-0000-4000-8000-000000000001";
let items: Map<string, string>;
beforeEach(() => {
  items = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => items.get(name) ?? null,
    setItem: (name: string, value: string) => void items.set(name, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

// D107: Remove from this device deletes a part, never its number.
describe("part numbers given on this device", () => {
  it("only ever rises, per session and per class key", () => {
    devicePartNumbers.raise(userId, [key, null], 2);
    devicePartNumbers.raise(userId, [key, session], 3);
    devicePartNumbers.raise(userId, [key, session], 1);
    expect(devicePartNumbers.highest(userId, [session])).toBe(3);
    expect(devicePartNumbers.highest(userId, [null, key])).toBe(3);
    expect(devicePartNumbers.highest(userId, [crypto.randomUUID()])).toBe(0);
    // Another account on the same device has numbers of its own.
    expect(devicePartNumbers.highest(crypto.randomUUID(), [session])).toBe(0);
  });

  it("is removed with the account's other learning data on this device (PrivacyView)", () => {
    devicePartNumbers.raise(userId, [session], 1);
    expect([...items.keys()]).toEqual([`recalino:learning-parts:${userId}:${session}`]);
    expect(PART_NUMBERS_PREFIX).toBe("recalino:learning-parts:");
  });

  it("ignores unreadable values and storage that is unavailable", () => {
    items.set(`${PART_NUMBERS_PREFIX}${userId}:${session}`, "not a number");
    expect(devicePartNumbers.highest(userId, [session])).toBe(0);
    vi.stubGlobal("localStorage", undefined);
    expect(() => devicePartNumbers.raise(userId, [session], 4)).not.toThrow();
    expect(devicePartNumbers.highest(userId, [session])).toBe(0);
  });
});
