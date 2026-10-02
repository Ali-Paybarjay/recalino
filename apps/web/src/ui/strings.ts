// Every UI string in one place (HANDOFF §0, copy.md). Words come verbatim from the design
// handoff: docs/design/handoff-r1/handoff/copy.md and the .dc.html frames. A string that is in
// neither must be an approved deviation in docs/design/HANDOFF_R1_REVIEW.md; strings.test.ts
// enforces this. Placeholders use {name} and are filled with fill().

export const strings = {
  brand: {
    name: "Recalino",
    wordmark: "recalino",
    tagline: "Turn your English class into clear notes and a short daily review.",
  },
  nav: {
    today: "Today",
    classes: "Classes",
    review: "Review",
    me: "Me",
    newClass: "New class",
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
  classStatus: {
    readyToProcess: "Ready to process",
    waitingForAllowance: "Waiting for allowance",
    inQueue: "In queue",
    processing: "Processing",
    needsAction: "Needs your action",
    partlyReady: "Partly ready · {detail}",
    ready: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  sourceStatus: {
    onThisDevice: "On this device",
    sending: "Sending for processing…",
    sent: "Sent for processing",
    serverCopyDeleted: "Server copy deleted",
    notOnThisDevice: "Original audio isn't on this device",
    uploading: "Uploading {done}/{total}",
    checking: "Checking…",
    received: "Received",
    notAccepted: "Not accepted: {reason}",
    needsAction: "Needs your action: {action}",
  },
  sourceChip: {
    notOnThisDevice: "{label} · not on this device",
    notKept: "{label} · no longer kept",
  },
  provenance: {
    class: "From class",
    ai: "AI explanation",
    edited: "Edited by you",
    experimental: "Experimental quality",
    reportProblem: "Report a problem",
    computerVoice: "Computer voice",
  },
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
  // M3 — B1-empty, B3 and F1 empty states (Design System, frame H-rules).
  empty: {
    today: "Record your first class. We'll help you make notes and cards from it.",
    classes: "No classes yet. Add your first class.",
    review: "No cards yet. Cards appear after a class is processed.",
  },
  // M3 — G3 (frame G3) and the Sign out button (HANDOFF_R1_REVIEW item 8).
  settings: {
    title: "Settings",
    termsChanged:
      "The Terms changed on {date}. Please read and accept them to keep processing new classes.",
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

/** Replaces each {name} in a template with its value. A missing value is an error, not a gap. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing value for {${name}}`);
    }
    return String(value);
  });
}
