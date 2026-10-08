// Read-only deployment readiness: node --env-file=<explicit-env-file> tools/auth/check-google.mjs
// Supabase Auth Settings exposes only enabled-provider flags; no OAuth sign-in is started.
// Source: https://github.com/supabase/auth/blob/master/internal/api/settings.go
import { isIPv4 } from "node:net";
import { pathToFileURL } from "node:url";

const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const MASKED = /^(?:\[SENSITIVE\]|\[REDACTED\]|\*+)$/i;
const MAXIMUM_RESPONSE_BYTES = 32 * 1024;

function endpoint(env) {
  const raw = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if ([raw, key].some((value) => typeof value === "string" && MASKED.test(value))) {
    return { errorCategory: "configuration_masked" };
  }
  if (
    typeof raw !== "string" ||
    !VISIBLE_ASCII.test(raw) ||
    typeof key !== "string" ||
    key.length < 20 ||
    key.length > 8192 ||
    !VISIBLE_ASCII.test(key) ||
    key.startsWith("sb_secret_")
  ) {
    return { errorCategory: "configuration_invalid" };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { errorCategory: "configuration_invalid" };
  }
  const host = url.hostname;
  const cloud =
    url.protocol === "https:" &&
    /^[a-z0-9][a-z0-9-]*\.supabase\.co$/.test(host) &&
    (url.port === "" || url.port === "443");
  const loopback =
    url.protocol === "http:" &&
    (host === "localhost" || host === "[::1]" || (isIPv4(host) && host.startsWith("127.")));
  if (
    (!cloud && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    return { errorCategory: "configuration_invalid" };
  }
  return { url: new URL("/auth/v1/settings", url), key, projectHost: host };
}

async function readSettings(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/** Injected dependencies keep tests independent from cloud credentials and provider traffic. */
export async function checkGoogle({
  env = process.env,
  fetch = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
} = {}) {
  const result = {
    checkedAt: now().toISOString(),
    status: null,
    googleEnabled: null,
    projectHost: null,
    errorCategory: null,
  };
  const configuration = endpoint(env);
  if (configuration.errorCategory) {
    return { ...result, errorCategory: configuration.errorCategory };
  }
  result.projectHost = configuration.projectHost;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(configuration.url, {
      method: "GET",
      headers: { apikey: configuration.key, accept: "application/json" },
      // Never forward the API key to an endpoint selected by an upstream redirect.
      redirect: "error",
      signal: controller.signal,
    });
    result.status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      return { ...result, errorCategory: "upstream_failed" };
    }
    const settings = await readSettings(response);
    if (typeof settings?.external?.google !== "boolean") {
      return { ...result, errorCategory: "malformed_response" };
    }
    result.googleEnabled = settings.external.google;
    return {
      ...result,
      errorCategory: result.googleEnabled ? null : "provider_disabled",
    };
  } catch {
    // No upstream message, response body, query, credential or user data is printed.
    return {
      ...result,
      errorCategory: controller.signal.aborted ? "timeout" : "network_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await checkGoogle();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.errorCategory === null && result.googleEnabled === true ? 0 : 1;
}
