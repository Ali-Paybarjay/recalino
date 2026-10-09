import { describe, expect, it } from "vitest";
import { createSessionSchema, isCalendarDate } from "./schemas";
import { sessionDisplayTitle } from "./sessions";

describe("FR-ORG-004 calendar titles", () => {
  it("rejects impossible dates and preserves leap days", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-2-04")).toBe(false);
    expect(createSessionSchema.parse({ title: "  " }).title).toBe(null);
    expect(sessionDisplayTitle(null, "2026-10-04")).toBe("Session — 4 Oct 2026");
  });
});
