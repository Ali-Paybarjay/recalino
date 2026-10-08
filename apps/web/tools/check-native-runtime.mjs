// Run on the build host as well as locally: mock stores cannot verify native Linux binaries.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import canvasRuntime from "@napi-rs/canvas";
import executable from "ffmpeg-static";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const voiceRuntime = require("sherpa-onnx-node");
if (
  typeof voiceRuntime.OfflineSpeakerDiarization !== "function" ||
  typeof voiceRuntime.SpeakerEmbeddingExtractor !== "function"
)
  throw new Error("native_voice_runtime_unusable");
if (!executable || !existsSync(executable)) throw new Error("native_audio_binary_missing");
const ffmpeg = spawnSync(executable, ["-nostdin", "-version"], {
  shell: false,
  windowsHide: true,
  timeout: 10000,
  maxBuffer: 65536,
  encoding: "utf8",
});
if (ffmpeg.error || ffmpeg.status !== 0 || !ffmpeg.stdout.startsWith("ffmpeg version "))
  throw new Error("native_audio_binary_unusable");
const { createCanvas } = canvasRuntime;
const canvas = createCanvas(2, 2);
const context = canvas.getContext("2d");
context.fillStyle = "red";
context.fillRect(0, 0, 2, 2);
if (context.getImageData(0, 0, 1, 1).data[0] !== 255 || canvas.toBuffer("image/png").length < 32)
  throw new Error("native_canvas_unusable");
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
// PDF.js loads its optional canvas from its own physical package, not the app's node_modules.
const pdfRequire = createRequire(join(pdfRoot, "package.json"));
if (pdfRequire("@napi-rs/canvas").createCanvas(1, 1).width !== 1)
  throw new Error("native_pdf_canvas_unusable");
const image = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "red" },
})
  .png()
  .toBuffer();
const imageMetadata = await sharp(image).metadata();
if (imageMetadata.width !== 2 || imageMetadata.height !== 2 || imageMetadata.format !== "png")
  throw new Error("native_sharp_unusable");
for (const resource of [
  "wasm/openjpeg.wasm",
  "cmaps",
  "standard_fonts",
  "legacy/build/pdf.worker.mjs",
])
  if (!existsSync(join(pdfRoot, resource))) throw new Error("native_pdf_resource_missing");
console.log(
  JSON.stringify({
    nativeRuntime: {
      platform: process.platform,
      architecture: process.arch,
      audio: "passed",
      canvas: "passed",
      pdfResources: "present",
      pdfCanvas: "passed",
      sharp: "passed",
      voice: "loaded",
    },
  }),
);
