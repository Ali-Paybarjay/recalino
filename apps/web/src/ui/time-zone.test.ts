import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { timeZoneCity as setupTimeZoneCity } from "../app/setup/languages";
import { timeZoneCity } from "./time-zone";

describe("time-zone labels in shared UI", () => {
  it("names the city of a zone", () => {
    expect(timeZoneCity("Europe/London")).toBe("London");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneCity("UTC")).toBe("UTC");
  });

  it("is the same helper the setup screens use", () => {
    expect(setupTimeZoneCity).toBe(timeZoneCity);
  });

  it("keeps shared UI free of imports from app/", () => {
    const offenders = readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
      .filter((file) =>
        /from "(?:\.\.\/)+app\//.test(readFileSync(join(import.meta.dirname, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
