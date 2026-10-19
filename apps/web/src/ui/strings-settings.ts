// PERF-06: one area of the UI strings, so a client component bundles only the words it shows.
// strings.ts composes every area into the one `strings` object, and strings.test.ts checks the
// origin of each string there (HANDOFF §0, copy.md).

/** Settings (frame G3). */
export const settingsStrings = {
  // M3 — G3 (frame G3) and the Sign out button (HANDOFF_R1_REVIEW item 8).
  settings: {
    title: "Settings",
    termsChanged:
      "The Terms changed on {date}. Please read and accept them to keep processing new sessions.",
    readAndAccept: "Read and accept",
    profile: "Profile",
    firstLanguage: "First language",
    explanationsIn: "Explanations in",
    levelGoal: "Level · Goal",
    timezone: "Time zone",
    notesUnchanged: "Your notes don't change.",
    signOut: "Sign out",
  },
} as const;
