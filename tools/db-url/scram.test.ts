import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  alterRoleStatement,
  CLOUD_TARGET,
  connectionString,
  generatePassword,
  scramVerifier,
} from "./scram";

// RFC 7677 section 3: the SCRAM-SHA-256 exchange for user "user" and password "pencil".
const RFC = {
  password: "pencil",
  salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64"),
  authMessage: [
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
  ].join(","),
  clientProof: "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  serverSignature: "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
};

function parse(verifier: string) {
  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  if (!match) throw new Error("bad verifier");
  const [, iterations, salt, storedKey, serverKey] = match as unknown as string[];
  return {
    iterations: Number(iterations),
    salt: String(salt),
    storedKey: Buffer.from(String(storedKey), "base64"),
    serverKey: Buffer.from(String(serverKey), "base64"),
  };
}

const hmac = (key: Buffer, text: string) => createHmac("sha256", key).update(text).digest();

// The rotation tool behind FR-PLT-009's key rotation (SECRETS.md), M4 task T10.
describe("FR-PLT-009 password rotation with a SCRAM-SHA-256 verifier", () => {
  it("accepts the RFC 7677 client proof and produces its server signature, as Postgres would", () => {
    const verifier = parse(scramVerifier(RFC.password, RFC.salt, 4096));
    expect(verifier.iterations).toBe(4096);
    expect(verifier.salt).toBe("W22ZaJ0SNY7soEsUEjb6gQ==");

    // Server side of the exchange: recover ClientKey from the proof and compare its hash.
    const clientSignature = hmac(verifier.storedKey, RFC.authMessage);
    const proof = Buffer.from(RFC.clientProof, "base64");
    const clientKey = Buffer.from(proof.map((byte, i) => byte ^ (clientSignature[i] ?? 0)));
    expect(createHash("sha256").update(clientKey).digest()).toEqual(verifier.storedKey);
    expect(hmac(verifier.serverKey, RFC.authMessage).toString("base64")).toBe(RFC.serverSignature);
  });

  it("uses a fresh salt and the default 4096 iterations", () => {
    const first = parse(scramVerifier("same-password"));
    const second = parse(scramVerifier("same-password"));
    expect(first.iterations).toBe(4096);
    expect(Buffer.from(first.salt, "base64")).toHaveLength(16);
    expect(first.salt).not.toBe(second.salt);
  });

  it("makes 43-character base64url passwords that need no URL encoding", () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generatePassword()).not.toBe(password);
    expect(encodeURIComponent(password)).toBe(password);
  });

  it("builds the pooler connection string the app accepts", () => {
    expect(connectionString("p4ss_word-1")).toBe(
      "postgresql://recalino_app.twowhuzhvyuzjrpraikm:p4ss_word-1@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    );
    expect(CLOUD_TARGET.user.startsWith(`${CLOUD_TARGET.role}.`)).toBe(true);
  });

  it("puts only the verifier in the SQL statement", () => {
    const password = generatePassword();
    const statement = alterRoleStatement("recalino_app", scramVerifier(password));
    expect(statement).toMatch(
      /^alter role recalino_app with password 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+';$/,
    );
    expect(statement).not.toContain(password);
    expect(() => alterRoleStatement("recalino_app", password)).toThrow("not a SCRAM-SHA-256");
    expect(() => scramVerifier("has space")).toThrow("printable ASCII");
  });
});
