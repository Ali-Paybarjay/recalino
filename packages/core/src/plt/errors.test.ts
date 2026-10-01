import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, ERROR_STATUS, errorEnvelopeSchema, errors, toErrorResponse } from "./errors";

const CANARY = "CANARY-class-text-7f3a";

describe("FR-PLT-003 error envelope", () => {
  it("gives every code a fixed status and a schema-valid envelope", () => {
    for (const code of Object.keys(ERROR_STATUS) as (keyof typeof ERROR_STATUS)[]) {
      const response = toErrorResponse(new AppError(code), "req-1");
      expect(response.status).toBe(ERROR_STATUS[code]);
      expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
      expect(response.body.error.request_id).toBe("req-1");
    }
  });

  it("turns zod failures into validation_failed with per-field codes and no input values", () => {
    const schema = z.object({ title: z.string().max(5), date: z.iso.date() });
    const parsed = schema.safeParse({ title: CANARY, date: "not-a-date" });
    const response = toErrorResponse(parsed.error, "req-2");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_failed");
    expect(response.body.error.details).toEqual({
      fields: { title: ["too_big"], date: ["invalid_format"] },
    });
    expect(JSON.stringify(response.body)).not.toContain(CANARY);
  });

  it("answers unexpected errors with internal and the request id only", () => {
    const response = toErrorResponse(new Error(`select * from secret where x='${CANARY}'`), "r3");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "internal",
        message: "Something went wrong. Please try again.",
        request_id: "r3",
      },
    });
  });

  it("answers another user's resource exactly like a missing one", () => {
    const denied = toErrorResponse(errors.ownershipDenied(), "r4");
    const missing = toErrorResponse(errors.notFound(), "r4");
    expect(denied.body).toEqual(missing.body);
    expect(denied.status).toBe(404);
  });

  it("puts Retry-After on rate_limited", () => {
    expect(toErrorResponse(errors.rateLimited(42), "r5").headers).toEqual({ "Retry-After": "42" });
  });
});
