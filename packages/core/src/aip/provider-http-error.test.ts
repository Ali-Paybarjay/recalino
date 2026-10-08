import { describe, expect, it } from "vitest";
import { providerHttpErrorCode } from "./provider-http-error";

describe("AIP private provider request diagnostics", () => {
  it.each([
    { error: { message: "Schema is too complex for compilation." } },
    {
      error: {
        message: "Provider returned error",
        metadata: {
          raw: JSON.stringify({
            error: {
              message:
                "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
            },
          }),
        },
      },
    },
    {
      error: {
        message: "Provider returned error",
        metadata: {
          raw: JSON.stringify({
            error: { message: "Too many optional parameters: 27 (limit 24)" },
          }),
        },
      },
    },
    { error: { metadata: { raw: "Schema is too complex for compilation. private user content" } } },
  ])("classifies the request rejection without returning provider content", async (body) => {
    expect(await providerHttpErrorCode(new Response(JSON.stringify(body), { status: 400 }))).toBe(
      "provider_request_schema_too_complex",
    );
  });

  it.each([
    "private malformed provider response",
    JSON.stringify({ error: { message: "Invalid request with private input" } }),
    JSON.stringify({ error: { message: "x".repeat(16_385) } }),
    JSON.stringify({ choices: [{ message: "Schema is too complex for compilation." }] }),
  ])("keeps unknown or oversized diagnostics private", async (body) => {
    expect(await providerHttpErrorCode(new Response(body, { status: 400 }))).toBe(
      "provider_http_400",
    );
  });

  it.each([401, 403, 429, 500, 503])("does not reclassify HTTP %s", async (status) => {
    const response = new Response(
      '{"error":{"message":"Schema is too complex for compilation."}}',
      {
        status,
      },
    );
    expect(await providerHttpErrorCode(response)).toBe(`provider_http_${status}`);
    expect(response.bodyUsed).toBe(false);
  });
});
