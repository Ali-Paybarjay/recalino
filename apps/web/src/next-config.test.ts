import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../next.config";

const header = (key: string) => SECURITY_HEADERS.find((entry) => entry.key === key)?.value;

describe("baseline security headers (SEC-03)", () => {
  it("forbids framing and plugins, and limits referrer, sniffing and device access", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Permissions-Policy")).toBe("camera=(), geolocation=(), microphone=(self)");
    const policy = header("Content-Security-Policy")
      ?.split(";")
      .map((part) => part.trim());
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    // No script-src yet: a nonce-based policy needs the full end-to-end run first.
    expect(policy?.some((part) => part.startsWith("script-src"))).toBe(false);
  });

  it("lets the notes frame keep its about:srcdoc base, which a srcdoc document inherits the policy for", () => {
    // ClassNotesFrame inserts <base href="about:srcdoc"> so in-notes links such as #top stay in
    // the frame. A srcdoc frame inherits this page policy, so base-uri must allow that one scheme.
    const baseUri = header("Content-Security-Policy")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("base-uri "));
    expect(baseUri?.split(/\s+/).slice(1)).toEqual(["'self'", "about:"]);
  });

  it.each([
    "/",
    "/today",
    "/admin",
    "/api/health",
    "/sessions/7d3f4c2e-1b2a-4c5d-8e9f-0a1b2c3d4e5f/notes",
  ])("sends every header on %s", async (path) => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const applied = rules
      .filter((rule) => getPathMatch(rule.source)(path) !== false)
      .flatMap((rule) => rule.headers.map((entry) => entry.key));
    for (const { key } of SECURITY_HEADERS) expect(applied).toContain(key);
  });
});
