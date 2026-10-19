import { randomUUID } from "node:crypto";
import type { Database } from "@recalino/core/db";
import { describe, expect, it } from "vitest";
import { type Handler, idempotencyKey, learnerActor, type RequestContext } from "./api";
import { coursesHandler } from "./org-routes";
import { cardActionsHandler } from "./study-routes";
import { supportFeedbackHandler } from "./support-routes";

// Audit QUA-04: every route reads the learner and the Idempotency-Key through one helper pair.
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("database must not be touched");
    },
  },
) as Database;
const ctx: RequestContext = {
  requestId: "synthetic-request",
  route: "probe",
  userId: randomUUID(),
};
const post = (key?: string) =>
  new Request("http://localhost/api/probe", {
    method: "POST",
    headers: key === undefined ? {} : { "Idempotency-Key": key },
  });
const problem = (code: string) => ({
  code: "validation_failed",
  details: { fields: { "Idempotency-Key": [code] } },
});

describe("shared route helpers (FR-PLT-002, FR-PLT-004)", () => {
  it("returns the signed-in learner and rejects a missing session", () => {
    expect(learnerActor(ctx)).toEqual({ userId: ctx.userId, requestId: ctx.requestId });
    expect(() => learnerActor({ ...ctx, userId: null })).toThrow(
      expect.objectContaining({ code: "unauthenticated" }),
    );
  });

  it("reports a missing key as required and a malformed key as invalid", () => {
    const key = randomUUID();
    expect(idempotencyKey(post(key))).toBe(key);
    expect(() => idempotencyKey(post())).toThrow(expect.objectContaining(problem("required")));
    for (const malformed of ["short", "has spaces in it", "x".repeat(201), ""]) {
      expect(() => idempotencyKey(post(malformed))).toThrow(
        expect.objectContaining(problem("invalid")),
      );
    }
  });

  // org, study and support used to pass any non-empty key on to the domain layer.
  const routes: [string, Handler, unknown][] = [
    ["org: create course", coursesHandler(), { name: "Synthetic course" }],
    [
      "study: card action",
      cardActionsHandler(randomUUID()),
      { expectedVersion: 1, action: "suspend" },
    ],
    ["support: feedback", supportFeedbackHandler(), { message: "Synthetic feedback" }],
  ];
  it.each(routes)(
    "%s rejects a malformed key before any database work",
    async (_, handler, input) => {
      for (const [key, code] of [
        [undefined, "required"],
        ["bad key!", "invalid"],
      ] as const) {
        await expect(
          handler({ request: post(key), input, ctx, db: untouched }),
        ).rejects.toMatchObject(problem(code));
      }
    },
  );
});
