import { describe, expect, it } from "vitest";
import { formatPartDate } from "./recording-format";

describe("formatPartDate", () => {
  it("writes a short day, month and time", () => {
    expect(formatPartDate("2026-10-18T13:30:45.000Z", "UTC")).toBe("18 Oct, 13:30");
  });

  it("uses the given time zone", () => {
    expect(formatPartDate("2026-10-18T13:30:45.000Z", "Asia/Tehran")).toBe("18 Oct, 17:00");
  });

  it("shows nothing for a date it cannot read", () => {
    expect(formatPartDate("not a date")).toBe("");
  });
});
