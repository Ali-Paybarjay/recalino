import type { Dimension } from "@recalino/core/quota";

/** Allowance names and units as the learner's allowance page shows them (FR-QUOTA-003). */
export const allowanceLabels: Record<Dimension, string> = {
  audio: "Class audio",
  document: "Pages and images",
  regeneration: "New versions",
  tts: "Speech characters",
  storage: "File storage",
};
export function allowanceUnits(dimension: Dimension, value: number): string {
  if (dimension === "audio") return `${Math.floor(value / 60)} min ${value % 60} sec`;
  if (dimension === "storage")
    return `${(value / 1048576).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MB`;
  return value.toLocaleString("en-GB");
}
