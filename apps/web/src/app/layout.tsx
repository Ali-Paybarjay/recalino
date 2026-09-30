import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recalino",
  description: "Class notes, cards and daily review.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// The interface is English and left-to-right; content blocks set their own lang and dir
// (PRD-ONB-01, FR-PLT-011).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
