import { describe, expect, it } from "vitest";
import { canonicalJson } from "./hash";
import { assertOwner } from "./ownership";
import { DEFAULT_PLT_SETTINGS, pltSettingsSchema, readPltSettings } from "./settings";

describe("PLT settings (Q-PLT-2)", () => {
  it("has valid proposed defaults", () => {
    expect(pltSettingsSchema.safeParse(DEFAULT_PLT_SETTINGS).success).toBe(true);
    expect(readPltSettings({})).toBe(DEFAULT_PLT_SETTINGS);
  });

  it("merges overrides from PLT_SETTINGS_JSON without a code change", () => {
    const settings = readPltSettings({
      PLT_SETTINGS_JSON: JSON.stringify({
        rateLimits: { export: { limit: 3 } },
        studyDayStartHour: 5,
      }),
    });
    expect(settings.rateLimits.export).toEqual({ limit: 3, windowSeconds: 3600, scopes: ["user"] });
    expect(settings.studyDayStartHour).toBe(5);
    expect(settings.idempotencyTtlSeconds).toBe(DEFAULT_PLT_SETTINGS.idempotencyTtlSeconds);
  });

  it("names invalid settings without echoing values", () => {
    expect(() => readPltSettings({ PLT_SETTINGS_JSON: "{not json" })).toThrow(/not valid JSON/);
    expect(() =>
      readPltSettings({ PLT_SETTINGS_JSON: JSON.stringify({ studyDayStartHour: 99 }) }),
    ).toThrow(/^Invalid PLT_SETTINGS_JSON: studyDayStartHour$/);
  });
});

describe("canonical JSON", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });
});

describe("FR-PLT-002 ownership check", () => {
  const ctx = { userId: "user-a" };

  it("returns the resource for its owner", () => {
    expect(assertOwner({ ownerId: "user-a", id: 1 }, ctx)).toEqual({ ownerId: "user-a", id: 1 });
  });

  it("treats a missing resource as not_found without a security signal", () => {
    expect(() => assertOwner(undefined, ctx)).toThrow(
      expect.objectContaining({ code: "not_found", securitySignal: undefined }),
    );
  });

  it("treats another user's resource as not_found and marks it for a security event", () => {
    expect(() => assertOwner({ ownerId: "user-b" }, ctx)).toThrow(
      expect.objectContaining({ code: "not_found", securitySignal: "ownership_denied" }),
    );
  });
});
