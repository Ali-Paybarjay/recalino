// Read-only model metadata and key caps. Never prints a credential, account email or prompt.
import { loadEnvFile } from "node:process";

try {
  loadEnvFile("apps/web/.env.local");
} catch {}
const headers = process.env.OPENROUTER_API_KEY
  ? { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
  : {};
const mode = process.argv[2] ?? "models";
if (mode === "key") {
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers });
  if (!response.ok) throw new Error(`Key metadata request failed (${response.status})`);
  const { data } = await response.json();
  console.log(
    JSON.stringify({
      limit: data.limit,
      limitRemaining: data.limit_remaining,
      limitReset: data.limit_reset,
      isFreeTier: data.is_free_tier,
    }),
  );
} else {
  for (const modality of ["text", "transcription", "speech"]) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/models?output_modalities=${modality}`,
    );
    if (!response.ok) throw new Error(`Model metadata request failed (${response.status})`);
    const { data } = await response.json();
    const selected = new Set([
      "anthropic/claude-haiku-4.5",
      "openai/whisper-large-v3-turbo",
      "hexgrad/kokoro-82m",
      "deepgram/nova-3",
    ]);
    console.log(
      JSON.stringify({
        modality,
        models: data
          .filter((m) => selected.has(m.id))
          .map((m) => ({
            id: m.id,
            contextLength: m.context_length,
            pricing: m.pricing,
            parameters: m.supported_parameters,
            architecture: m.architecture,
          })),
      }),
    );
  }
}
