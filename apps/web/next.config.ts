import type { NextConfig } from "next";

const nativeProcessingResources = [
  "../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
  // Platform packages hold the real binary; traversing canvas's dependency symlink breaks function packaging.
  "../../node_modules/.pnpm/@napi-rs+canvas-*@*/node_modules/@napi-rs/canvas-*/*.node",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/wasm/**",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/cmaps/**",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/standard_fonts/**",
];

const nextConfig: NextConfig = {
  // Domain code is shipped as TypeScript source from the workspace (PROJECT_SPEC §5).
  transpilePackages: ["@recalino/core"],
  poweredByHeader: false,
  // Webpack's shared CSS merging otherwise sends account/study styles to the welcome page.
  // Keep component imports scoped to their routes and the base → tokens → app order intact.
  experimental: { cssChunking: false },
  // The recording verifier and bounded STT preparer use the platform's static decoder.
  serverExternalPackages: ["ffmpeg-static", "@napi-rs/canvas", "pdfjs-dist", "sharp"],
  outputFileTracingIncludes: {
    // Native PDF resource lookup reads metadata at runtime, including server-rendered estimate pages.
    "/*": ["../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/package.json"],
    "/dev/spike/**": ["../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg"],
    "/api/jobs/run": nativeProcessingResources,
    "/api/sources/**": nativeProcessingResources,
    "/api/classes/**": nativeProcessingResources,
    "/api/runs/**": nativeProcessingResources,
  },
};

export default nextConfig;
