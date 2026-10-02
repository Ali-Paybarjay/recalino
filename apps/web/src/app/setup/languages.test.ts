import { describe, expect, it } from "vitest";
import {
  languageName,
  timeZoneCity,
  timeZoneCountry,
  timeZoneNow,
  timeZoneOffset,
} from "./languages";

// The setup screens' names and time zone labels come from the runtime's Intl data (D31 rule 8).

describe("time zone labels", () => {
  it("shows the city with the short country name, as frame A2.6 does", () => {
    expect(timeZoneCity("Europe/London")).toBe("London");
    expect(timeZoneCountry("Europe/London")).toBe("UK");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneCountry("Asia/Tokyo")).toBe("Japan");
  });

  it("has no country for a zone that belongs to none", () => {
    expect(timeZoneCountry("UTC")).toBeNull();
  });

  it("formats the local time and the offset", () => {
    const summer = new Date("2026-07-01T08:41:00Z");
    expect(timeZoneNow("Europe/London", summer)).toBe("09:41");
    expect(timeZoneOffset("Europe/London", summer)).toBe("GMT+1");
  });
});

describe("language names", () => {
  it("gives the English and the native name", () => {
    const persian = languageName("fa");
    expect(persian.english).toBe("Persian");
    expect(persian.native).toBe("فارسی");
  });
});
