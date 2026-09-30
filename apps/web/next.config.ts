import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain code is shipped as TypeScript source from the workspace (PROJECT_SPEC §5).
  transpilePackages: ["@recalino/core"],
  poweredByHeader: false,
};

export default nextConfig;
