// PERF-06: one area of the UI strings, so a client component bundles only the words it shows.
// strings.ts composes every area into the one `strings` object, and strings.test.ts checks the
// origin of each string there (HANDOFF §0, copy.md).

/** The sign-in page (frames A1). */
export const signInStrings = {
  // M3 — A1 (frames A1-default, A1-failed, A1-desktop; copy.md "Consent").
  signIn: {
    adultsOnly: "For adults 18+",
    adult: "I am 18 or older",
    accept: "I accept the {terms} and {privacy}",
    terms: "Terms",
    privacy: "Privacy Notice",
    continue: "Continue with Google",
    tickBoth: "Please tick both boxes to continue.",
    needGoogle: "You need a Google account to join the pilot.",
    failed: "We couldn't sign you in. Please try again.",
    exampleTitle: "Example notes · ESOL Entry 3",
    exampleWord: "already",
    exampleQuote: '"I\'ve already finished my homework."',
    exampleSource: "Class audio · 18:42",
    exampleExplanation: "We use {word} when something happened earlier than expected.",
    exampleReview: "Then review a few cards each day.",
  },
} as const;
