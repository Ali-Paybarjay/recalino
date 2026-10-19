// PERF-06: one area of the UI strings, so a client component bundles only the words it shows.
// strings.ts composes every area into the one `strings` object, and strings.test.ts checks the
// origin of each string there (HANDOFF §0, copy.md).

/** First-run setup (frames A2-1 to A2-7). */
export const setupStrings = {
  // M3 — A2 (frames A2-1 to A2-7).
  setup: {
    progress: "{step} of 7",
    back: "Back",
    continue: "Continue",
    skip: "Skip",
    firstLanguage: "What is your first language?",
    search: "Search in English or your language",
    experimental: "Experimental",
    experimentalNote:
      "Explanations in {language} may have mistakes, so we always show English next to them.",
    noLanguage: "No language found. Check the spelling.",
    checkSpelling: "Check the spelling.",
    youAreLearning: "You are learning",
    english: "English",
    learningFixed: "Step 2 · fixed",
    explanationsIn: "Explanations in…",
    explanationsHelp:
      "Which language should Recalino use to explain words and grammar? You can change this any time.",
    chooseOne: "Please choose one.",
    level: "Your English level",
    levelHelp: "Optional. This is your own view. It isn't a test.",
    notSure: "Not sure",
    goal: "Your goal",
    goalEsol: "ESOL",
    goalIelts: "IELTS",
    goalGeneral: "General English",
    goalNone: "No specific goal",
    timezone: "Is this your time zone?",
    timezoneHelp: "We use it to plan your daily review.",
    timezoneNow: "{zone} · now {time}",
    timezoneYes: "Yes, that's right",
    timezoneChange: "Change time zone",
    consentTitle: "Recording other people",
    consentIntro:
      "When you record a class, your teacher's and classmates' voices are in the recording.",
    askFirst: "Ask first",
    askFirstText: "Before you record, ask your teacher and the people in your class if it is OK.",
    collegeRules: "Follow your college's rules",
    collegeRulesText: "If you are not sure, ask your teacher.",
    studyOnly: "Only for your study",
    studyOnlyText: "Don't share recordings with other people.",
    askedOnce: "We ask you this once. After this, we trust that you ask each time you record.",
    consentBox: "I understand that I must ask the people in my class before I record.",
    finish: "Finish setup",
  },
} as const;
