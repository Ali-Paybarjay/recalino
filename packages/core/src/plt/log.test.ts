import { describe, expect, it } from "vitest";
import { createLogger, formatLogLine } from "./log";

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
