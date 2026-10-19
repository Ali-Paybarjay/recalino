import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nativeProcessingResources = [
  "../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
  // Platform packages hold the real binary; traversing canvas's dependency symlink breaks function packaging.
  "../../node_modules/.pnpm/@napi-rs+canvas-*@*/node_modules/@napi-rs/canvas-*/*.node",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/wasm/**",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/cmaps/**",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/standard_fonts/**",
  "../../node_modules/.pnpm/sherpa-onnx-node@*/node_modules/sherpa-onnx-node/**",
  "../../node_modules/.pnpm/sherpa-onnx-*@*/node_modules/sherpa-onnx-*/*",
  "./src/server/voice-engine-worker.mjs",
  "./src/server/voice-engine-quality.mjs",
  "../../tools/voice/models/wespeaker_en_voxceleb_resnet34_LM.onnx",
  "../../tools/voice/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
  "../../tools/voice/models/sherpa-onnx-pyannote-segmentation-3-0/LICENSE",
  "../../tools/voice/models/models.manifest.json",
  "../../tools/voice/models/ATTRIBUTION.md",
];

const nextConfig: NextConfig = {
  // Domain code is shipped as TypeScript source from the workspace (PROJECT_SPEC §5).
  transpilePackages: ["@recalino/core"],
  poweredByHeader: false,
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  // Vercel's Next adapter packages functions inside next build, before post-build tracers run.
  ...(process.env.NEXT_ADAPTER_PATH
    ? {
        adapterPath: resolve(
          dirname(fileURLToPath(import.meta.url)),
          "tools/native-build-adapter.mjs",
        ),
      }
    : {}),
  // Webpack's shared CSS merging otherwise sends account/study styles to the welcome page.
  // Keep component imports scoped to their routes and the base → tokens → app order intact.
  experimental: { cssChunking: false },
  // The recording verifier and bounded STT preparer use the platform's static decoder.
  serverExternalPackages: [
    "ffmpeg-static",
    "@napi-rs/canvas",
    "pdfjs-dist",
    "sharp",
    "sherpa-onnx-node",
  ],
  outputFileTracingIncludes: {
    // Native PDF resource lookup reads metadata at runtime, including server-rendered estimate pages.
    "/*": ["../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/package.json"],
    "/api/jobs/run": nativeProcessingResources,
    "/api/sources/**": nativeProcessingResources,
    "/api/classes/**": nativeProcessingResources,
    "/api/runs/**": nativeProcessingResources,
    "/api/voice/**": nativeProcessingResources,
    "/api/me/voice": nativeProcessingResources,
  },
  // D51: learner pages moved from /classes to /sessions. Saved notifications, bookmarks and
  // installed shortcuts keep working; the /api/classes routes are unchanged.
  redirects() {
    return [{ source: "/classes/:path*", destination: "/sessions/:path*", permanent: true }];
  },
};

export default nextConfig;
