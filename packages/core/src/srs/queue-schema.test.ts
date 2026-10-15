import { expect, it } from "vitest";
import { reviewQueueQuerySchema } from "./schema";

it("D79: accepts one optional owned-session filter and no card-set selector", () => {
  expect(reviewQueueQuerySchema.parse({})).toEqual({});
  const sessionId = "6f1c1a52-6f4e-4d5b-9b55-5f2b8f0a4c11";
  expect(reviewQueueQuerySchema.parse({ sessionId })).toEqual({ sessionId });
  expect(reviewQueueQuerySchema.safeParse({ sessionId: "not-a-uuid" }).success).toBe(false);
  for (const studySet of ["production", "recognition", "legacy"])
    expect(reviewQueueQuerySchema.safeParse({ studySet }).success).toBe(false);
});
