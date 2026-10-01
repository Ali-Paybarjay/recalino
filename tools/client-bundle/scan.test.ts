import { describe, expect, it } from "vitest";
import { findSecrets, serverEnvNames } from "./scan";

describe("client bundle secret scan (FR-PLT-009)", () => {
  const names = serverEnvNames(
    "# comment\nDATABASE_URL=\nRATE_LIMIT_IP_KEY=\nNEXT_PUBLIC_SITE_URL=https://x\n",
  );

  it("reads server-only names from .env.example", () => {
    expect(names).toEqual(["DATABASE_URL", "RATE_LIMIT_IP_KEY"]);
  });

  it("finds a server variable referenced in client code", () => {
    const chunk = 'const url=process.env.DATABASE_URL;fetch("/api/health")';
    expect(findSecrets("chunk.js", chunk, names)).toEqual([
      { file: "chunk.js", match: "env name DATABASE_URL" },
    ]);
  });

  it("finds a planted credential", () => {
    const planted = [
      "postgresql://recalino_app:hunter2-secret@db.example:6543/postgres",
      "sb_secret_abcdefghij0123456789",
      "sk-ant-api03-abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY-----",
    ];
    for (const secret of planted) {
      expect(findSecrets("chunk.js", `var a="${secret}"`, names)).toHaveLength(1);
    }
  });

  it("passes ordinary client code", () => {
    const chunk =
      'export default function Page(){return "Recalino"}//postgres docs: postgres://host';
    expect(findSecrets("chunk.js", chunk, names)).toEqual([]);
  });
});
