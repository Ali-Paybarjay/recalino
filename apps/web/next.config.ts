import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nativeProcessingResources = [
  "../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
  // Platform packages hold the real binary; traversing canvas's dependency symlink breaks function packaging.
  "../../node_modules/.pnpm/@napi-rs+canvas-*@*/node_modules/@napi-rs/canvas-*/*.node",
  // The PDF renderer resolves its installed resources from the package metadata at runtime.
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/package.json",
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

/**
 * SEC-03: baseline security headers on every response. No page may be framed (clickjacking), no
 * plugin content loads, and only the app itself may use the microphone. The notes reader and the
 * admin email preview are srcdoc frames: they send no response headers, keep their own sandbox and
 * CSP, and inherit this policy. base-uri therefore also allows the non-network about: scheme, so
 * the notes frame keeps its <base href="about:srcdoc"> and in-notes links stay inside the frame.
 * A full CSP (script-src with a nonce) is a later step that needs the end-to-end run.
 */
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self' about:",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
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
  // PERF-01: native processing resources ship only with the job runner and the routes that run
  // processing jobs right after their response (runJobsSoon). Pages and other API routes load no
  // preparer, PDF.js or Canvas; the post-build tracers add native links to these functions only.
  outputFileTracingIncludes: {
    "/api/jobs/run": nativeProcessingResources,
    // An operator retry runs the processing job right after the response.
    "/api/admin": nativeProcessingResources,
    "/api/sources/**": nativeProcessingResources,
    "/api/classes/**": nativeProcessingResources,
    "/api/runs/**": nativeProcessingResources,
    "/api/voice/**": nativeProcessingResources,
    "/api/me/voice": nativeProcessingResources,
  },
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // D51: learner pages moved from /classes to /sessions. Saved notifications, bookmarks and
  // installed shortcuts keep working; the /api/classes routes are unchanged.
  redirects() {
    return [{ source: "/classes/:path*", destination: "/sessions/:path*", permanent: true }];
  },
};

export default nextConfig;
