/**
 * Session material list copy (D106), approved word for word by the product owner on 2026-10-20 and
 * recorded in docs/design/UI_COPY_PENDING.md. Every other text of the list is existing copy.
 */
export const sessionMaterialCopy = {
  // The add control at the end of a list that already has material; an empty list keeps "Add Files".
  addMore: "Add more material",
} as const;

/**
 * The add control's label. It reads "Add more material" whenever the list shows a line, saved or
 * still on its way, and keeps "Add Files" for a list that is really empty.
 */
export function addMaterialLabel(counts: { saved: number; pending: number; selected: number }) {
  return counts.saved || counts.pending || counts.selected
    ? sessionMaterialCopy.addMore
    : "Add Files";
}
