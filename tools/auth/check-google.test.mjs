import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkGoogle } from "./check-google.mjs";

const key = "sb_publishable_synthetic-readiness-key";
const env = { SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: key };
const now = () => new Date("2026-10-04T12:00:00.000Z");
const json = (value, status = 200) => Response.json(value, { status });

test("enabled provider requires the exact boolean flag and returns only safe metadata", async () => {
  const result = await checkGoogle({
    env,
    now,
    fetch: async (url, options) => {
      assert.equal(String(url), "https://synthetic.supabase.co/auth/v1/settings");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.apikey, key);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return json({
        external: { google: true },
        unexpectedUserData: "private-person@example.test",
      });
    },
  });
  assert.deepEqual(result, {
    checkedAt: now().toISOString(),
    status: 200,
    googleEnabled: true,
    projectHost: "synthetic.supabase.co",
    errorCategory: null,
  });
  assert.doesNotMatch(JSON.stringify(result), /private-person|publishable|apikey|auth\/v1/);
});

test("disabled provider is a failure despite a successful settings response", async () => {
  const result = await checkGoogle({
    env,
    fetch: async () => json({ external: { google: false } }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.googleEnabled, false);
  assert.equal(result.errorCategory, "provider_disabled");
});

test("missing, coerced and malformed provider responses cannot pass readiness", async () => {
  for (const settings of [null, {}, { external: {} }, { external: { google: "true" } }]) {
    const result = await checkGoogle({ env, fetch: async () => json(settings) });
    assert.equal(result.errorCategory, "malformed_response");
    assert.equal(result.googleEnabled, null);
  }
  for (const body of ["not JSON", "x".repeat(32 * 1024 + 1)]) {
    const result = await checkGoogle({ env, fetch: async () => new Response(body) });
    assert.equal(result.errorCategory, "malformed_response");
  }
});

test("upstream failures omit the response body and injected network error text", async () => {
  const upstream = await checkGoogle({
    env,
    fetch: async () => json({ message: key, user: "private-person" }, 503),
  });
  assert.equal(upstream.status, 503);
  assert.equal(upstream.errorCategory, "upstream_failed");
  const network = await checkGoogle({
    env,
    fetch: async () => {
      throw new Error(`${key} private-person`);
    },
  });
  assert.equal(network.errorCategory, "network_failed");
  assert.doesNotMatch(JSON.stringify([upstream, network]), /publishable|private-person/);
});

test("request timeout terminates the check without printing the abort error", async () => {
  const result = await checkGoogle({
    env,
    timeoutMs: 5,
    fetch: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error(key)), { once: true });
      }),
  });
  assert.equal(result.errorCategory, "timeout");
  assert.doesNotMatch(JSON.stringify(result), /publishable/);
});

test("invalid or masked environment values cannot make a request or expose a host", async () => {
  const invalidUrls = [
    undefined,
    "[SENSITIVE]",
    "[REDACTED]",
    "***",
    "https://synthetic.supabase.co/?secret=hidden",
    "https://synthetic.supabase.co/#secret",
    "https://hidden:secret@synthetic.supabase.co",
    "https://synthetic.supabase.co/other",
    "https://synthetic.supabase.co:444",
    "https://synthetic.supabase.co.attacker.test",
    "http://synthetic.supabase.co",
    "http://192.168.1.1",
    "https://synthetic.supabase.co\n",
  ];
  let requests = 0;
  const fetch = async () => {
    requests++;
    return json({ external: { google: true } });
  };
  for (const SUPABASE_URL of invalidUrls) {
    const result = await checkGoogle({ env: { ...env, SUPABASE_URL }, fetch });
    assert.match(result.errorCategory, /^configuration_(invalid|masked)$/);
    assert.equal(result.projectHost, null);
    assert.doesNotMatch(JSON.stringify(result), /hidden|secret=|attacker/);
  }
  for (const SUPABASE_PUBLISHABLE_KEY of [
    undefined,
    "[SENSITIVE]",
    "***",
    "short",
    `sb_secret_${key}`,
  ]) {
    const result = await checkGoogle({ env: { ...env, SUPABASE_PUBLISHABLE_KEY }, fetch });
    assert.match(result.errorCategory, /^configuration_(invalid|masked)$/);
  }
  assert.equal(requests, 0);
});

test("only explicit loopback HTTP targets are allowed for local checks", async () => {
  for (const host of ["localhost", "127.0.0.1", "127.2.3.4", "[::1]"]) {
    const result = await checkGoogle({
      env: { ...env, SUPABASE_URL: `http://${host}:54321` },
      fetch: async () => json({ external: { google: true } }),
    });
    assert.equal(result.errorCategory, null);
    assert.equal(result.projectHost, host);
  }
});

async function serverFixture(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("real fetch refuses an upstream redirect before leaking the key to its target", async () => {
  let targetRequests = 0;
  const fixture = await serverFixture((request, response) => {
    if (request.url === "/auth/v1/settings") {
      assert.equal(request.headers.apikey, key);
      response.writeHead(302, { location: "/unexpected-target" });
    } else {
      targetRequests++;
      response.writeHead(200);
    }
    response.end();
  });
  try {
    const result = await checkGoogle({ env: { ...env, SUPABASE_URL: fixture.url } });
    assert.equal(result.errorCategory, "network_failed");
    assert.equal(targetRequests, 0);
  } finally {
    await fixture.close();
  }
});

function cli(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--env-file=${file}`, fileURLToPath(new URL("./check-google.mjs", import.meta.url))],
      {
        env: { ...process.env, SUPABASE_URL: undefined, SUPABASE_PUBLISHABLE_KEY: undefined },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (part) => {
      stdout += part;
    });
    child.stderr.on("data", (part) => {
      stderr += part;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI loads an explicit Node env file and exits nonzero for a disabled provider", async () => {
  let enabled = false;
  const fixture = await serverFixture((request, response) => {
    assert.equal(request.url, "/auth/v1/settings");
    assert.equal(request.headers.apikey, key);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ external: { google: enabled } }));
  });
  const temporary = await mkdtemp(join(tmpdir(), "recalino-auth-check-"));
  try {
    const file = join(temporary, ".env");
    await writeFile(file, `SUPABASE_URL=${fixture.url}\nSUPABASE_PUBLISHABLE_KEY=${key}\n`);
    const disabled = await cli(file);
    assert.equal(disabled.code, 1);
    assert.equal(disabled.stderr, "");
    assert.equal(JSON.parse(disabled.stdout).errorCategory, "provider_disabled");
    enabled = true;
    const ready = await cli(file);
    assert.equal(ready.code, 0);
    assert.equal(ready.stderr, "");
    assert.equal(JSON.parse(ready.stdout).googleEnabled, true);
    assert.doesNotMatch(disabled.stdout + ready.stdout, /publishable|apikey|auth\/v1/);
  } finally {
    await fixture.close();
    // This is the exact directory returned by mkdtemp, never a computed user directory.
    await rm(temporary, { recursive: true, force: true });
  }
});
