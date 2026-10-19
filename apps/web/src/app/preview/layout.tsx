import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PreviewProvider } from "../../ui/preview/PreviewContext";
import "../../ui/workspace/workspace.css";
export const metadata: Metadata = {
  title: "Recalino · Design preview",
  robots: { index: false, follow: false },
};
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <PreviewProvider>{children}</PreviewProvider>;
}
