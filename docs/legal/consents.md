# Recalino in-app consent texts

Version 0.1 · Draft · 1 October 2026

> **Draft for development only.** This text is not final and has not had a legal review.

These are the short legal texts inside the app. The exact words come from the design copy ([copy.md](../design/handoff-r1/handoff/copy.md)) or from the design frame named in each section. Recalino saves the ID, version and time of each acceptance.

## Versions

| Text | ID | Version | Status |
|---|---|---|---|
| [Terms of Use](terms-of-use.md) | `terms` | 0.1 | Draft |
| [Privacy Notice](privacy-notice.md) | `privacy` | 0.3 | Draft |
| Recording consent (section 2) | `recording-consent` | 0.1 | Draft |
| Sources notice (section 3) | `sources-notice` | 0.1 | Draft |

The 18+ statement has no version. Recalino saves only the time it was given (FR-ACC-001).

## 1. Sign in: 18+ and Terms (A1)

**Where:** frame A1 "Welcome / sign in", before "Continue with Google". FR-ACC-001.

| Item | Text |
|---|---|
| Label under the logo | "For adults 18+" |
| Checkbox 1 | "I am 18 or older" |
| Checkbox 2 | "I accept the Terms and Privacy Notice" |
| Hint while a box is not ticked | "Please tick both boxes to continue." |
| Hint | "You need a Google account to join the pilot." |

**Rules:**

- Both checkboxes start unticked. "Continue with Google" stays disabled until both are ticked.
- "Terms" and "Privacy Notice" open the full texts in a sheet, so the ticks are not lost.
- Recalino saves the time of the 18+ statement, the versions of `terms` and `privacy`, and the time of acceptance.

## 2. Recording consent (A2.7)

**Where:** frame A2.7, the last step of profile setup. D33, FR-ACC-003.

| Item | Text |
|---|---|
| Title | "Recording other people" |
| Intro | "When you record a class, your teacher's and classmates' voices are in the recording." |
| Point 1 | "Ask first" — "Before you record, ask your teacher and the people in your class if it is OK." |
| Point 2 | "Follow your college's rules" — "If you are not sure, ask your teacher." |
| Point 3 | "Only for your study" — "Don't share recordings with other people." |
| Note | "We ask you this once. After this, we trust that you ask each time you record." |
| Checkbox | "I understand that I must ask the people in my class before I record." |
| Button | "Finish setup" |

**Rules:**

- The checkbox starts unticked. Setup can't finish without it.
- Recalino doesn't ask again before each recording.
- A new version is shown once, at the first sign-in after it is published. It never stops a one-tap recording (D33, rule 3).

## 3. Sources notice (A3)

**Where:** frame A3, the first time the learner adds files, including an audio file. Record never shows it. FR-SRC-015.

| Item | Text |
|---|---|
| Title | "Before you add class materials" |
| Section 1 | "What Recalino does" — "It turns your class audio and files into notes and cards. Only you can see them." |
| Section 2 | "Where your audio is kept" — "The recording stays on this device. We send a temporary copy to our server only to make a transcript. We delete that copy automatically." |
| Section 3 (added) | "Where your files are kept" — "Your photos and other files are kept privately on our server until you delete them." |
| Section 4 | "Your college's rules" — "Follow your college's rules about recording. If you are not sure, ask your teacher." |
| Link | "Read the Privacy Notice" |
| Checkbox | "I have the right to use these materials for my private study" |
| Button | "Continue" |

**Section 3 is new in this draft.** FR-SRC-015 says the notice must explain how files are kept, not only audio. The design frame has no such line. The change is recorded in [HANDOFF_R1_REVIEW.md](../design/HANDOFF_R1_REVIEW.md), item 6.

**Rules:**

- The checkbox starts unticked. "Continue" stays disabled until it is ticked.
- The notice is shown once for each version. The server refuses a new source if the learner has not accepted the current version.
