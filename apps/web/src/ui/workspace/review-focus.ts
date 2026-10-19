/**
 * Where keyboard and screen-reader focus goes in a review session (A11Y-03). The control that
 * had focus ("Show answer", a grade button, "Undo last answer") is replaced by the next state,
 * so without this the focus falls back to the top of the page after every card.
 */
export type FocusIntent = "answer" | "next" | null;
export type FocusTarget = "answer" | "show-answer" | "done" | null;

/**
 * - After "Show answer" the focus moves to the answer region.
 * - After a grade or an undo it moves to the next card's "Show answer", or to the end-of-session
 *   panel when no card is left. While the answer of the old card is still showing, nothing moves yet.
 */
export function reviewFocusTarget(
  intent: FocusIntent,
  view: { shown: boolean; hasCard: boolean },
): FocusTarget {
  if (intent === "answer") return view.shown && view.hasCard ? "answer" : null;
  if (intent === "next") {
    if (view.shown) return null;
    return view.hasCard ? "show-answer" : "done";
  }
  return null;
}
