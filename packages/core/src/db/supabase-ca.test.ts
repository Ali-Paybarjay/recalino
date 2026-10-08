import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

describe("PRD-SEC-04 the database CA in the repository", () => {
  it("is the Supabase Root 2021 CA recorded in supabase-ca.ts", () => {
    const certificate = new X509Certificate(SUPABASE_ROOT_CA);
    expect(certificate.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
    expect(certificate.ca).toBe(true);
    expect(certificate.subject).toContain("CN=Supabase Root 2021 CA");
    expect(certificate.validToDate.toISOString()).toBe("2031-04-26T10:56:53.000Z");
  });
});
