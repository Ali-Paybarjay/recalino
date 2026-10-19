import { describe, expect, it } from "vitest";
import { causeCode, createLogger, errorLocation, formatLogLine } from "./log";

const CANARY = "CANARY-class-text-7f3a";
const NOW = new Date("2026-10-01T09:00:00.000Z");

describe("FR-PLT-007 allow-listed logging", () => {
  it("keeps allowed identifier fields", () => {
    const line = JSON.parse(
      formatLogLine(
        "info",
        "request",
        { request_id: "abc-123", route: "health", status: 200 },
        NOW,
      ),
    );
    expect(line).toEqual({
      time: "2026-10-01T09:00:00.000Z",
      level: "info",
      event: "request",
      request_id: "abc-123",
      route: "health",
      status: 200,
    });
  });

  it("drops unknown fields and redacts non-identifier values", () => {
    const line = formatLogLine(
      "error",
      "request",
      { transcript: CANARY, route: `I said ${CANARY} in class`, body: { text: CANARY } },
      NOW,
    );
    expect(line).not.toContain(CANARY);
    expect(JSON.parse(line)).toMatchObject({ route: "[redacted]", dropped_fields: 2 });
  });

  it("never writes a signed URL", () => {
    const signed = "https://store.example/blob/abc?token=secret-signature&expires=1";
    const line = formatLogLine("info", "upload", { route: signed }, NOW);
    expect(line).not.toContain("secret-signature");
    expect(line).not.toContain("https://");
  });

  it("writes a generic line if sanitising fails", () => {
    const hostile = {};
    Object.defineProperty(hostile, "route", {
      enumerable: true,
      get() {
        throw new Error(CANARY);
      },
    });
    const line = formatLogLine("info", "request", hostile, NOW);
    expect(JSON.parse(line)).toEqual({
      time: "2026-10-01T09:00:00.000Z",
      level: "error",
      event: "log_record_failed",
    });
  });

  it("sends formatted lines to the sink", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line))("warn", "security_event", { kind: "rate_limited" });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "security_event",
      kind: "rate_limited",
    });
  });
});

describe("OPS-02 error location and cause code (PRD-PRIV-06)", () => {
  const IDENTIFIER = /^[A-Za-z0-9_.:/\-[\]]{1,128}$/;

  it("names the first stack frame as a relative file and line, without the message", () => {
    const location = errorLocation(new TypeError(CANARY));
    expect(location).toMatch(/^packages\/core\/src\/plt\/log\.test\.ts:\d+:\d+$/);
    expect(location).not.toContain(CANARY);
    expect(
      JSON.parse(formatLogLine("error", "request_failed", { error_location: location }, NOW)),
    ).toMatchObject({ error_location: location });
  });

  it("never reads frames out of a multi-line message", () => {
    const error = new Error(`${CANARY}\n    at evil (/srv/${CANARY}.ts:1:1)`);
    const location = errorLocation(error);
    expect(location).toBeDefined();
    expect(location).not.toContain(CANARY);
  });

  it("keeps dependency frames from node_modules and drops absolute prefixes", () => {
    const error = new Error("x");
    error.stack = [
      "Error: x",
      "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
      "    at Parser.parse (/home/alice/app/node_modules/.pnpm/pg-protocol@1.0.0/node_modules/pg-protocol/dist/parser.js:39:38)",
    ].join("\n");
    expect(errorLocation(error)).toBe("node_modules/pg-protocol/dist/parser.js:39:38");
    error.stack = "Error: x\n    at /var/task/somewhere/else/deep/chunk 1.js:1:2";
    const outside = errorLocation(error, "/srv/app");
    expect(outside).toBe("else/deep/chunk_1.js:1:2");
    expect(outside).toMatch(IDENTIFIER);
  });

  it("has no location for values that are not errors or have no frames", () => {
    expect(errorLocation("boom")).toBeUndefined();
    const error = new Error("x");
    error.stack = "Error: x";
    expect(errorLocation(error)).toBeUndefined();
  });

  it("reads only an identifier-like provider cause code", () => {
    expect(causeCode(Object.assign(new Error("x"), { causeCode: "ECONNRESET" }))).toBe(
      "ECONNRESET",
    );
    expect(
      causeCode(Object.assign(new Error("x"), { causeCode: `bad ${CANARY}` })),
    ).toBeUndefined();
    expect(causeCode(new Error("x"))).toBeUndefined();
    expect(causeCode(null)).toBeUndefined();
  });
});
