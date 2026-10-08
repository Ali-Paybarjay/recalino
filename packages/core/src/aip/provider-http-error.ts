const MAX_ERROR_BYTES = 16_384;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** PRD-PRIV-06: classify known request failures without retaining provider text or echoed inputs. */
export async function providerHttpErrorCode(response: Response): Promise<string> {
  const fallback = `provider_http_${response.status}`;
  if (response.status !== 400 || !response.body) return fallback;
  const reader = response.body.getReader();
  try {
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return fallback;
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    const error = object(object(JSON.parse(body))?.error);
    if (!error) return fallback;
    const metadata = object(error.metadata);
    const diagnostics = [error.message];
    // OpenRouter wraps the upstream JSON error in metadata.raw.
    if (typeof metadata?.raw === "string") {
      try {
        diagnostics.push(object(object(JSON.parse(metadata.raw))?.error)?.message);
      } catch {
        // Some providers supply a plain error message instead of JSON.
        diagnostics.push(metadata.raw);
      }
    }
    if (
      diagnostics.some(
        (value) =>
          typeof value === "string" &&
          (/schema is too complex for compilation/i.test(value) ||
            /compiled grammar is too large/i.test(value) ||
            /too many optional (?:parameters|properties)/i.test(value)),
      )
    )
      return "provider_request_schema_too_complex";
    return fallback;
  } catch {
    return fallback;
  } finally {
    // A large, malformed or interrupted diagnostic must not change retry/accounting semantics.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
