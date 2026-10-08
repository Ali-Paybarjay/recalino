import { afterEach, expect, it, vi } from "vitest";
import { readWebPushConfiguration } from "./processing-notifications";

afterEach(() => vi.unstubAllEnvs());
it("disables push safely for missing or malformed VAPID configuration", () => {
  for (const name of [
    "RECALINO_WEB_PUSH_PUBLIC_KEY",
    "RECALINO_WEB_PUSH_PRIVATE_KEY",
    "RECALINO_WEB_PUSH_SUBJECT",
  ])
    vi.stubEnv(name, "");
  expect(readWebPushConfiguration()).toBeNull();
  vi.stubEnv("RECALINO_WEB_PUSH_PUBLIC_KEY", "a".repeat(87));
  vi.stubEnv("RECALINO_WEB_PUSH_PRIVATE_KEY", "b".repeat(43));
  vi.stubEnv("RECALINO_WEB_PUSH_SUBJECT", "https://recalino.invalid/development");
  expect(readWebPushConfiguration()).toEqual({
    publicKey: "a".repeat(87),
    privateKey: "b".repeat(43),
    subject: "https://recalino.invalid/development",
  });
  vi.stubEnv("RECALINO_WEB_PUSH_SUBJECT", "http://localhost");
  expect(readWebPushConfiguration()).toBeNull();
});
