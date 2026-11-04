import { describe, expect, it } from "vitest";
import mock from "../../../tools/eval/synthetic-mock-config.json";
import { assertLocalEvaluationDatabase, evaluationConfigSchema } from "./evaluation-config";

describe("isolated synthetic evaluation gates", () => {
  it("requires explicit complete configuration and enough total headroom for all four calls", () => {
    expect(evaluationConfigSchema.safeParse(mock).success).toBe(true);
    expect(evaluationConfigSchema.safeParse({ ...mock, maximumTotalMicros: 39 }).success).toBe(
      false,
    );
    expect(evaluationConfigSchema.safeParse({ ...mock, maximumTotalMicros: 100001 }).success).toBe(
      false,
    );
    expect(
      evaluationConfigSchema.safeParse({
        ...mock,
        provider: { ...mock.provider, modelMaximumMicros: { "synthetic/tts": 11 } },
      }).success,
    ).toBe(false);
  });
  it("rejects cloud databases and alternate services before any budget or account write", () => {
    expect(() =>
      assertLocalEvaluationDatabase("postgresql://example:example@127.0.0.1:54322/postgres"),
    ).not.toThrow();
    for (const target of [
      "postgresql://example:example@db.example.com:54322/postgres",
      "postgresql://example:example@127.0.0.1:5432/postgres",
      "postgresql://example:example@127.0.0.1:54322/production",
      "https://127.0.0.1:54322/postgres",
    ])
      expect(() => assertLocalEvaluationDatabase(target)).toThrow(
        "local_supabase_database_required",
      );
  });
  it("accepts the default local URL and rejects a loopback URL with a query string", () => {
    expect(() =>
      assertLocalEvaluationDatabase("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
    ).not.toThrow();
    // node-postgres lets `host` (and TLS options) in the query override the checked host.
    for (const target of [
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.example.com",
      "postgresql://postgres:postgres@localhost:54322/postgres?host=db.example.com",
      "postgresql://postgres:postgres@[::1]:54322/postgres?host=db.example.com",
      "postgres://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
    ]) {
      let error: unknown;
      try {
        assertLocalEvaluationDatabase(target);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("local_supabase_database_required");
      expect((error as Error).message).not.toContain("example.com");
    }
  });
  it.each(["llmModel", "visionModel"] as const)(
    "bounds the physical output override for active %s",
    (slot) => {
      const model = mock.provider[slot];
      expect(
        evaluationConfigSchema.safeParse({
          ...mock,
          provider: {
            ...mock.provider,
            structuredModelOverrides: {
              [model]: { maxOutputTokens: 12000, reasoningEffort: "low" },
            },
          },
        }).success,
      ).toBe(false);
      expect(
        evaluationConfigSchema.safeParse({
          ...mock,
          provider: {
            ...mock.provider,
            structuredModelOverrides: { [model]: { maxOutputTokens: 4000 } },
          },
        }).success,
      ).toBe(true);
    },
  );
  it("does not change evaluation bounds for an unused rollback model override", () => {
    expect(
      evaluationConfigSchema.safeParse({
        ...mock,
        provider: {
          ...mock.provider,
          structuredModelOverrides: {
            "anthropic/claude-haiku-5.5": { maxOutputTokens: 12000, reasoningEffort: "low" },
          },
        },
      }).success,
    ).toBe(true);
  });
});
