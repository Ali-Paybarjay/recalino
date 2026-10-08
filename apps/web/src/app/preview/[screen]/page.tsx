import { notFound } from "next/navigation";
import { PreviewApp } from "../../../ui/preview/PreviewApp";
import { PREVIEW_KEYS } from "../../../ui/preview/screens";
export const dynamicParams = false;
export function generateStaticParams() {
  return PREVIEW_KEYS.map((screen) => ({ screen }));
}
export default async function PreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!PREVIEW_KEYS.some((key) => key === screen)) notFound();
  return <PreviewApp screen={screen} />;
}
