import { describe, expect, it } from "vitest";
import { isValidTimeZone, resolveTimeZone, studyDay } from "./time";

const START = 4;
const at = (iso: string) => new Date(iso);

describe("FR-PLT-013 study day", () => {
  it("starts at 04:00 local time", () => {
    expect(studyDay(at("2026-10-01T02:59:00Z"), "Europe/London", START)).toBe("2026-09-30");
    expect(studyDay(at("2026-10-01T03:00:00Z"), "Europe/London", START)).toBe("2026-10-01");
  });

  it("is right when British Summer Time starts (29 Mar 2026)", () => {
    // 01:00 GMT jumps to 02:00 BST; 04:00 BST is 03:00 UTC.
    expect(studyDay(at("2026-03-29T02:59:00Z"), "Europe/London", START)).toBe("2026-03-28");
    expect(studyDay(at("2026-03-29T03:00:00Z"), "Europe/London", START)).toBe("2026-03-29");
  });

  it("is right when British Summer Time ends (25 Oct 2026)", () => {
    // 02:00 BST falls back to 01:00 GMT; 04:00 GMT is 04:00 UTC.
    expect(studyDay(at("2026-10-25T03:59:00Z"), "Europe/London", START)).toBe("2026-10-24");
    expect(studyDay(at("2026-10-25T04:00:00Z"), "Europe/London", START)).toBe("2026-10-25");
  });

  it("works in zones without daylight saving and with half-hour offsets", () => {
    expect(studyDay(at("2026-10-01T18:59:00Z"), "Asia/Tokyo", START)).toBe("2026-10-01");
    expect(studyDay(at("2026-10-01T19:00:00Z"), "Asia/Tokyo", START)).toBe("2026-10-02");
    expect(studyDay(at("2026-10-01T00:29:00Z"), "Asia/Tehran", START)).toBe("2026-09-30");
    expect(studyDay(at("2026-10-01T00:30:00Z"), "Asia/Tehran", START)).toBe("2026-10-01");
  });

  it("changes only the display when the time zone changes; the stored instant stays the same", () => {
    // 05:30 in London (BST) but 00:30 in New York (EDT), before the 04:00 boundary.
    const instant = at("2026-10-02T04:30:00Z");
    const before = instant.toISOString();
    expect(studyDay(instant, "Europe/London", START)).toBe("2026-10-02");
    expect(studyDay(instant, "America/New_York", START)).toBe("2026-10-01");
    expect(instant.toISOString()).toBe(before);
  });

  it("falls back to UTC for unknown zones and says so", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toEqual({ timeZone: "UTC", fallback: true });
    expect(resolveTimeZone(null)).toEqual({ timeZone: "UTC", fallback: true });
    expect(resolveTimeZone("Asia/Tokyo")).toEqual({ timeZone: "Asia/Tokyo", fallback: false });
  });
});
