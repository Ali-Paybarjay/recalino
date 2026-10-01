import type { MetadataRoute } from "next";
import { strings } from "../ui/strings";
import { THEME_COLORS } from "../ui/theme";

// Web app manifest (FR-PLT-010). Colours and install icons as in HANDOFF §5c; the files in
// public/icons are copies of the design package (icons.test.ts).
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
