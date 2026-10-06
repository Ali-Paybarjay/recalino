/** Real ONNX smoke inference with synthetic PCM only; never loads a user's recording. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkVoiceRuntime } from "../../apps/web/src/server/voice-engine.ts";

export async function checkVoiceModelRuntime() {
  return checkVoiceRuntime();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  console.log(JSON.stringify({ voiceModelRuntime: await checkVoiceModelRuntime() }));
