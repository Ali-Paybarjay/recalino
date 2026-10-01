import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Load order is part of the design (HANDOFF §2): base → tokens → app.
import "../ui/styles/vendor/nocturne-base.css";
import "../ui/styles/vendor/tokens.css";
import "../ui/styles/app.css";
import { strings } from "../ui/strings";
import { THEME_COLORS, THEME_SCRIPT } from "../ui/theme";

export const metadata: Metadata = {
  title: strings.brand.name,
  description: strings.brand.tagline,
  // HANDOFF §5c: the SVG favicon with a 32 px PNG fallback, and the opaque Apple touch icon.
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the bottom navigation and sheets keep clear of the iPhone home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

// The interface is English and left-to-right; content blocks set their own lang and dir
// (PRD-ONB-01, FR-PLT-011). data-theme starts light and the theme script corrects it before the
// first paint, so React leaves the attribute alone (suppressHydrationWarning).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="light" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script with no user data. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
