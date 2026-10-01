import type { Metadata } from "next";
import { UiKit } from "./UiKit";

export const metadata: Metadata = {
  title: "UI kit",
};

export default function UiKitPage() {
  return <UiKit />;
}
