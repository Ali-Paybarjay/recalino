import { describe, expect, it } from "vitest";
import { defineRoute } from "./api";
import type { RouteMeta } from "./routes";

const route: RouteMeta = {
  id: "domain-create",
  path: "/api/domain-create",
  access: "learner",
  idempotency: "handler",
};
describe("domain-owned route idempotency", () => {
  it("validates the key before calling a domain handler and leaves its transaction to the domain", async () => {
    let calls = 0;
    const handler = defineRoute(
      route,
      async ({ ctx, request }) => {
        calls++;
        expect(ctx.userId).toBe("owner");
        expect(request.headers.get("idempotency-key")).toBe("valid-key-12345");
        return { status: 201, body: { id: "created" } };
      },
      {
        sessions: { getSession: async () => ({ userId: "owner" }) },
        database: () => {
          throw new Error("The wrapper must not open its own database transaction.");
        },
        log: () => {},
      },
    );
    for (const key of [null, "bad key"]) {
      const response = await handler(
        new Request("http://localhost/api/domain-create", {
          method: "POST",
          headers: key ? { "idempotency-key": key } : {},
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(calls).toBe(0);
    const response = await handler(
      new Request("http://localhost/api/domain-create", {
        method: "POST",
        headers: { "idempotency-key": "valid-key-12345" },
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "created" });
    expect(calls).toBe(1);
  });
});
