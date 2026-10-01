import type { MetadataRoute } from "next";
import { strings } from "../ui/strings";
import { THEME_COLORS } from "../ui/theme";

// Web app manifest (FR-PLT-010). Icons and colours from design round 2
// (docs/design/handoff-r2-icons/HANDOFF.md, section 5c).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: strings.brand.name,
    short_name: strings.brand.name,
    description: strings.brand.tagline,
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
