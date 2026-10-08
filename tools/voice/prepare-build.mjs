/** Provision once at build time. Runtime requests never download acoustic weights. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkVoiceModelRuntime } from "./check-model-runtime.mjs";
import { provisionVoiceModels } from "./fetch-models.mjs";

const required = process.env.VERCEL === "1" || process.env.RECALINO_PROVISION_VOICE_MODELS === "1";
if (required) console.log(JSON.stringify({ voiceModels: await provisionVoiceModels() }));
const localModels = fileURLToPath(new URL("./models/", import.meta.url));
if (required || existsSync(localModels) || process.env.VOICE_SEGMENTATION_MODEL_PATH)
  console.log(JSON.stringify({ voiceModelRuntime: await checkVoiceModelRuntime() }));
else
  console.log(
    JSON.stringify({ voiceModelRuntime: "not provisioned in this optional local build" }),
  );
