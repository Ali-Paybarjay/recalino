// Copy introduced by the current UI redesign. Existing legal and consent copy stays in strings.ts.
export const experienceCopy = {
  welcome: {
    eyebrow: "MORE FROM EVERY ENGLISH CLASS",
    description:
      "Keep the useful moments from class, understand them clearly, and build a little practice into every day.",
    loopLabel: "The learning routine we are building",
    steps: [
      { title: "Session", description: "Record or add your material." },
      { title: "Notes", description: "Make sense of what you learnt." },
      { title: "Review", description: "Practise a few cards each day." },
    ],
    formTitle: "Set up your learning space",
    exampleEyebrow: "A GLIMPSE OF YOUR NOTES",
    exampleHeading: "A useful moment,\nready to remember.",
    exampleLabel: "Example",
    exampleNote: "An example only. Your notes will come from your own classes.",
  },
  setup: {
    title: "Make Recalino yours",
    description: "A few choices to help you learn. You can update your preferences in Settings.",
    progress: "{step} of {total}",
    progressLabel: "Setup progress",
    screens: [
      "First language",
      "Explanations",
      "Level and goal",
      "Daily review",
      "Recording",
      "Your voice",
    ],
    previewNote: "Development preview · sample preferences. Saving needs a real test account.",
    previewNav: "Preview setup screens",
  },
} as const;
