// PERF-06: one area of the UI strings, so a client component bundles only the words it shows.
// strings.ts composes every area into the one `strings` object, and strings.test.ts checks the
// origin of each string there (HANDOFF §0, copy.md).

/** The learner shell: brand, navigation, shared controls and empty states. */
export const shellStrings = {
  brand: {
    name: "Recalino",
    wordmark: "recalino",
    tagline: "Turn your English class into clear notes and a short daily review.",
  },
  nav: {
    today: "Today",
    classes: "Courses",
    review: "Review",
    me: "Me",
    newClass: "New session",
    reviewDue: "{count} due",
    skipToContent: "Skip to content",
  },
  common: {
    close: "Close",
    undo: "Undo",
    tryAgain: "Try again",
    confirmIrreversible: "I understand this can't be undone",
    clearSearch: "Clear search",
  },
  // M3 — B1-empty, B3 and F1 empty states (Design System, frame H-rules).
  empty: {
    today: "Record your first session. We'll help you make notes and cards from it.",
    classes: "No sessions yet. Add your first session.",
    review: "No cards yet. Cards appear after a session is processed.",
  },
} as const;
