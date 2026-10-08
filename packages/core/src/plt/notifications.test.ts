import { describe, expect, it } from "vitest";
import { browserPushSubscriptionSchema, isBrowserPushEndpoint } from "./notifications";

describe("browser push endpoint validation", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/opaque",
    "https://updates.push.services.mozilla.com/wpush/v2/opaque",
    "https://web.push.apple.com/opaque",
    "https://wns2.notify.windows.com/opaque",
  ])("allows the supported browser service %s", (endpoint) => {
    expect(isBrowserPushEndpoint(endpoint)).toBe(true);
  });
  it.each([
    "http://fcm.googleapis.com/send/opaque",
    "https://fcm.googleapis.com.evil.example/send/opaque",
    "https://example.com/?next=fcm.googleapis.com",
    "https://fcm.googleapis.com:8443/send/opaque",
    "https://attacker@fcm.googleapis.com/send/opaque",
    "https://127.0.0.1/api/admin",
    "https://169.254.169.254/latest/meta-data/",
    "not a URL",
  ])("rejects an arbitrary or internal destination %s", (endpoint) => {
    expect(isBrowserPushEndpoint(endpoint)).toBe(false);
  });
  it("accepts the browser's serialization but rejects malformed encryption keys", () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/opaque",
      expirationTime: null,
      keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
    };
    expect(browserPushSubscriptionSchema.parse(subscription)).toEqual(subscription);
    expect(
      browserPushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { p256dh: "invalid", auth: "b".repeat(22) },
      }).success,
    ).toBe(false);
  });
});
