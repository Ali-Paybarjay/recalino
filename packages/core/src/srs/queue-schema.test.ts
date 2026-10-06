import { expect, it } from "vitest";
import { reviewQueueQuerySchema } from "./schema";

it("accepts only the supported public review-set selectors and valid owned-session identifiers", () => {
  for (const studySet of ["production", "recognition", "legacy"])
    expect(reviewQueueQuerySchema.parse({ studySet })).toEqual({ studySet });
  expect(reviewQueueQuerySchema.parse({})).toEqual({});
  for (const studySet of ["", "all", "Production", "production,recognition", null])
    expect(reviewQueueQuerySchema.safeParse({ studySet }).success).toBe(false);
  expect(reviewQueueQuerySchema.safeParse({ sessionId: "not-a-uuid" }).success).toBe(false);
});
