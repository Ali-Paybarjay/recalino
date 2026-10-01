import type { MetadataRoute } from "next";
import { strings } from "../ui/strings";
import { THEME_COLORS } from "../ui/theme";

// Web app manifest (FR-PLT-010). The install icons come with design round 2
// (docs/design/APP_ICON_REQUEST.md); until then the app is not installable.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: strings.brand.name,
    short_name: strings.brand.name,
    description: strings.brand.tagline,
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
  };
}
