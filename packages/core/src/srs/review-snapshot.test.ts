import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { storedScheduleSchema } from "./review";

// QUA-05: srs.review_event before_state/after_state are parsed, not cast.
const written = {
  cardId: randomUUID(),
  version: 3,
  state: { due: "2026-10-20T10:00:00.000Z", stability: 2.5, reps: 2 },
  dueAt: "2026-10-20T10:00:00.000Z",
  introducedAt: "2026-10-18T09:00:00.000Z",
};

describe("stored card schedule (QUA-05)", () => {
  it("accepts a schedule as recordReview writes it, unchanged", () => {
    expect(storedScheduleSchema.parse(written)).toEqual(written);
    expect(storedScheduleSchema.parse({ ...written, introducedAt: null }).introducedAt).toBeNull();
    const { introducedAt: _i, ...withoutIntroduction } = written;
    expect(storedScheduleSchema.parse(withoutIntroduction)).toEqual(withoutIntroduction);
  });
  it("rejects a schedule without the version or due time replay returns", () => {
    const { version: _v, ...noVersion } = written;
    const { dueAt: _d, ...noDue } = written;
    expect(storedScheduleSchema.safeParse(noVersion).success).toBe(false);
    expect(storedScheduleSchema.safeParse(noDue).success).toBe(false);
    expect(storedScheduleSchema.safeParse({ ...written, dueAt: "tomorrow" }).success).toBe(false);
  });
});
