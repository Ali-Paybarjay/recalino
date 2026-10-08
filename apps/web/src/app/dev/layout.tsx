import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { devUiEnabled } from "../../server/dev-ui";

// UI test pages (M2): every component in every state, for comparing with the design frames and
// for the end-to-end accessibility checks. Not a product page; 404 in production.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: ReactNode }) {
  // Next replaces this direct NODE_ENV access at build time; passing the whole env object
  // relies on a runtime property which is absent in some deployment adapters.
  if (
    !devUiEnabled({
      NODE_ENV: process.env.NODE_ENV,
      RECALINO_DEV_UI: process.env.RECALINO_DEV_UI,
    })
  )
    notFound();
  return children;
}
