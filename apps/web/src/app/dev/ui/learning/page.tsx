import { LearningReference } from "./LearningReference";
import "../../../../ui/workspace/workspace.css";

/** Guarded by /dev/layout; every API request is intercepted in browser tests. */
export default async function LearningReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return <LearningReference progress={view === "progress"} />;
}
