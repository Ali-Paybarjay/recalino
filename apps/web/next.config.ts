import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain code is shipped as TypeScript source from the workspace (PROJECT_SPEC §5).
  transpilePackages: ["@recalino/core"],
  poweredByHeader: false,
  // SPIKE-05 only (M4, T5): ship the static ffmpeg binary with the spike route. Removed in T6.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/dev/spike/[action]": [
      "../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg",
    ],
  },
};

export default nextConfig;
