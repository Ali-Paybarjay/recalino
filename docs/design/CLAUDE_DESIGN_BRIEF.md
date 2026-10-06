# Recalino — MVP UI Design Brief (for Claude Design)

You are designing the complete user interface for the MVP of **Recalino**, a web app for adult English learners. Your output will be handed to Claude Code, which will implement it in React (Next.js). Please read the whole brief before starting.

**What I need from you, in this order:**

1. A **design system** for Recalino: tokens, components and states.
2. **Screens** for every flow in section 8, for mobile and desktop.
3. A **clickable prototype** of the core loop (section 9).
4. A **handoff for Claude Code**: annotated specs, tokens and a component inventory (section 11).

If something in this brief is unclear or contradicts itself, make a sensible assumption, label it in the design, and list it in your "Assumptions and open questions" page. Do not invent product features that are not in this brief.

---

## 1. The product in one paragraph

Recalino turns the materials of an English class into a study system. After (or during) a class, the learner records the class audio on their phone, or adds files: board photos, worksheets (PDF), HTML pages or text. Recalino processes these sources into **structured, source-referenced notes** and **suggested flashcards**. The learner approves the cards they want, and a spaced-repetition engine (FSRS) schedules a **short daily review**. The core value is one loop: *class sources → clear notes → cards → daily review*.

Recalino is a study aid. It never promises mastery, exam scores or an official language level.

## 2. Who uses it

- **Adult learners (18+ only)** in a UK college ESOL / English class. The pilot group is multinational: first languages include Russian, Japanese, Chinese, Persian and others.
- **Their English level varies from A1 to C1.** The interface is in English, so **UI copy must be plain, short and easy** (aim for A2–B1 readability): short sentences, common words, no idioms, no jargon.
- **Context of use:**
  - **In class, on a phone:** starting a recording quickly, often one-handed, then leaving the phone on the desk for up to 3 hours.
  - **At home, on a laptop or phone:** reading notes, approving cards, doing a 10–15 minute daily review.
- **Design personas** (not research results):
  - An ESOL learner who needs clear explanations with help from their first language.
  - A university student who wants organised sources and examples linked to the exact document page and audio time.
  - A busy learner who wants a short review and to see "what's due today" at a glance.

## 3. Platform and technical constraints

- **Responsive web app / PWA**, mobile-first. Target browsers: Chrome on Android, Safari on iOS, Chrome and Edge on desktop.
- Design for **390 × 844** (mobile) and **1440 × 900** (desktop). Tablet may follow the desktop layout.
- **Implementation:** React on Next.js. The styling library is **not chosen yet**. Keep tokens as **CSS custom properties** and keep components framework-agnostic. If your design assumes a specific library (for example Tailwind CSS or shadcn/ui), say so explicitly in the handoff.
- **Fonts: device/system fonts only.**
  - No web fonts and nothing loaded from a CDN. Learners' content appears in many scripts, and bundling fonts for all of them would make the app heavy.
  - Use a system font stack and let the device choose script-specific fonts.
- **Performance matters:** light pages, no heavy decorative imagery, no autoplaying media.
- **Themes:** design the light theme first and also define dark-theme tokens (the app follows the system setting).
- **Icons:** use an open-source icon set (for example Lucide) and name the set you use. No copyrighted illustrations.

## 4. Brand and visual direction

- The name **Recalino** is final. It refers to *recall* and consolidating what you learn.
- **The visual identity is provisional** (brand work is a later gate). Create a simple typographic wordmark as a placeholder. Do not spend effort on a final logo, and avoid resembling existing brands.
- **Mood:** calm, focused, trustworthy, warm, adult. The reading surface for notes should feel like a clean, well-set study page, with generous whitespace and strong readability.
- **Avoid:**
  - Childish styling.
  - Gamification pressure: streak shaming, guilt messages, leaderboards, confetti overload.
  - "AI magic" clichés.
  - Anything that looks like a clone of Duolingo, Anki or Quizlet.
  - Red for normal things like "cards due", which should not feel alarming.
- **Colour must never be the only signal.** Every status and label also has text and/or an icon.

## 5. Non-negotiable UX rules

These come from product decisions. The design must make them easy to follow and impossible to break by accident.

**1. Recording is never interrupted.**
- While recording, show **no** pop-ups, sounds, notifications or warnings about duration, the 90-minute split or the processing allowance. Those messages appear **only after Stop**.
- **Real failures are never hidden.** If the microphone stops, local saving fails, or recording actually stops, the screen shows it **immediately** as a clear inline indicator, with no sound or modal.
- The app must never show "Recording" while it is not actually capturing and saving audio.

**2. Status words are truthful.**
- "Saved on this device" appears only after the local save has really completed.
- "Sent for processing" appears only after the server confirms it received the file.
- Never say "Saved to your account" for class audio.
- A file is "Received" only after the server has checked it.
- A partial result is never called "complete notes". Use, for example: "Part 2 isn't ready yet. These notes use Part 1 and the worksheet only."

**3. Where content comes from is always visible.** Notes and cards mix three kinds of content that must stay visually distinct (label + icon + subtle colour):
- **From class:** said in the audio, seen on the board, or in a class file. It always has at least one **source chip**, for example "Class audio · 18:42", "Worksheet · page 4" or "Board photo 2". Tapping a chip plays that audio range or opens that page or photo.
- **AI explanation:** added by the AI to help. It is never presented as something the teacher said.
- **Edited by you:** the learner changed it. It never looks like the teacher's original words.
- "Worksheet, page 4" is different from "Teacher at 18:42". Only audio evidence plus a confirmed teacher role may say the teacher said it. Otherwise use "Mentioned in class discussion".

**4. Audio stays on the learner's device.**
- The original recording lives on the device where it was recorded. A temporary copy goes to the server only for transcription and is deleted automatically.
- Playing an audio reference therefore works **only on that device**. On other devices show: "The original audio isn't on this device."
- If an original file was deleted, show: "The original file is no longer kept." Never show a broken link or a fake reference.

**5. Consent is explicit.**
- Checkboxes for "I am 18 or older", "I accept the Terms and Privacy Notice" and "I have the right to use these class materials for my private study" are **never pre-checked**.
- The action they unlock stays disabled until they are checked.

**6. Allowance (quota) is honest and calm.**
- Before any processing, show the estimate next to what is left, for example "This uses **46 min** of your **4 h 20 min**". Nothing is sent before the learner confirms.
- If there isn't enough, offer choices: keep it for later, process only a part, save a copy to this device, or ask the pilot operator for more.
- **There are no prices, plans, upgrade or payment screens in this pilot.** Don't design any.

**7. First language: any script.** Learners pick their first language (L1) and choose explanations in **English** or **their first language**.
- Content blocks can be in any script, including right-to-left (Persian, Arabic, Urdu) and CJK (Chinese, Japanese, Korean), inside an English, left-to-right interface.
- Each content block takes its own direction: RTL blocks are right-aligned inside the LTR UI.
- Mixed text must not scramble, for example: *The word "already" یعنی قبلاً.*
- Some languages are marked **"Experimental quality"**. For those, the L1 explanation is shown **side by side with the English one**, with a small label and a "Report a problem" action.

**8. The learner stays in control.**
- Generating content again creates a **new suggested version**. It never silently overwrites the learner's edits or history.
- Show a clear comparison and let the learner choose.

**9. Honest progress.**
- No fake numbers like "91% mastered".
- A review backlog stays visible. Never fake that reviews are done.
- The learner's self-reported level and the app's estimated support level are shown **separately**, with uncertainty.

**10. Accessibility: WCAG 2.2 AA** on all main flows.
- Visible focus and full keyboard use.
- Text contrast of at least 4.5:1.
- Touch targets of at least 44 × 44 px. Make recording controls larger.
- Labels on every control.
- Reduced-motion support.
- Screen-reader-friendly status changes.

---

## 6. Out of scope: do not design these, not even as placeholders or "coming soon"

Library or EPUB reader, book translation, "Ask my class" chat, teacher or organisation accounts, sharing between users, social features or leaderboards, under-18 users, native mobile apps, live transcription or live AI, pronunciation scoring, AI image generation, Anki import or sync, fully offline review, pricing, plans or payment, video recording.

## 7. Information architecture (a proposal you may refine)

- **Mobile:** bottom navigation with **Today**, **Classes**, **Review** and **Me**. **Me** holds Progress, Settings and Allowance. A prominent **New class** action is on Today and Classes.
- **Desktop:** left sidebar with the same items.
- **The recording screen** is a full-screen focus mode with no navigation.
- **Terms to use consistently in the UI:**

  | Term | Meaning |
  |---|---|
  | Class | One real lesson |
  | Course | A group of classes |
  | Unit | Optional sub-group inside a course |
  | Sources | Audio and files of a class |
  | Notes | The study notes generated for a class |
  | Cards | Flashcards |
  | Review | Daily practice |
  | Allowance | Processing quota |

## 8. Screens and states

For each screen, show the **default** state plus the listed states. Every list also needs its **empty, loading and error** states.

### A. Sign-in and first-time setup

- **A1. Welcome / sign in.**
  - One-line value statement and "For adults 18+".
  - Two unchecked consent checkboxes (18+; Terms and Privacy Notice).
  - A **Continue with Google** button, disabled until both are checked. Google is the only sign-in method.
  - A short honest line: "You need a Google account to join the pilot."
  - States: sign-in cancelled or failed (a general message that doesn't reveal whether an account exists).
- **A2. Profile setup** (short multi-step, resumable):
  1. **First language:** a searchable list showing each name in English and in the language itself ("Persian — فارسی", "Japanese — 日本語", "Russian — Русский"). Selecting an experimental-quality language shows a small badge and one sentence explaining what that means.
  2. **Learning language:** English. It is fixed and shown for information only.
  3. **Explanations in:** two options, "English" or the learner's first language (for example "فارسی"). **Nothing is preselected.**
  4. **Your level (optional):** A1, A2, B1, B2, C1, C2 or "Not sure".
  5. **Your goal (optional):** ESOL, IELTS, General English or "No specific goal".
  6. **Time zone:** detected automatically, with a Confirm or Change option.
- **A3. Before your first recording or upload** (shown once per notice version):
  - What Recalino does with class materials.
  - How audio is stored: on this device, plus a temporary server copy only for transcription, deleted automatically.
  - That the learner must follow their college's rules on recording.
  - An unchecked "I have the right to use these materials for my private study" checkbox.
- **A4. Recording readiness check** (before the first recording):
  - Microphone permission, browser support, free storage on the device.
  - The advice "Keep this page open and the screen on during class; recording may stop if the phone locks or you switch apps".
  - If recording isn't supported, a clear path to **upload an audio file instead**, shown now rather than after the class.

### B. Organise

- **B1. Today (home).**
  - A review card at the top: "12 cards due · 5 new · about 15 min", with a Start button.
  - A **New class** button.
  - Recent classes, each with a status chip (see C7).
  - Empty state for a brand-new user: one friendly sentence and New class.
- **B2. New class** (bottom sheet on mobile, dialog on desktop):
  - Title (optional).
  - Date (default: today).
  - Course (optional; if left empty the class goes into the default course "My classes").
  - Unit (optional, only after a course is chosen).
- **B3. Classes and course pages.**
  - A course list.
  - A course page with classes grouped by unit plus a "No unit" group.
  - Create or rename a course or unit.
  - Delete only when empty, with a helpful message if it isn't.

### C. Capture

- **C1. Class page** (the hub of one class):
  - Header: title (or "Class — 30 Sep 2026" if untitled), date, course.
  - **Sources list.** Each row shows type, name, role and status, with an include-in-processing toggle.
    - Audio statuses: "On this device", "Sending for processing…", "Sent for processing", "Server copy deleted", and on other devices "Original audio isn't on this device".
    - File statuses: "Uploading 3/10", "Checking…", "Received", "Not accepted" with a reason, "Needs your action" (for example "Upload a copy without a password").
  - **Add sources:** Record, Add audio file, Add photos/PDF/HTML/text, and Use a previous source (a picker inside this dialog, not a library page).
  - **Source role:** Automatically identify class audio, board photos, class material or notes during processing. Do not ask the learner to classify the file (D43).
  - **File selection:** Default to Whole file. For PDF and audio, offer Whole file / Part of file choices; show Start/End only for Part of file, using page numbers or labelled audio time units. Save selection records the extent for the next processing run without starting processing or editing the original (D43).
  - A banner when sources changed after notes were made: "New sources since your notes were made", with an option to update affected parts. The update is never automatic.
  - A **Processing** section (C5–C7) and, when ready, entry points to **Notes** and **Cards**.
- **C2. Recording** (full-screen focus mode):
  - A large active-recording timer and a clear state: Recording, Paused, or a problem state.
  - Big Pause/Resume and Stop controls, and **Take photo**. Photos are timestamped against the recording clock.
  - A subtle, calm "Saving on this device" health indicator.
  - **Problem states** (inline, silent, obvious): "Microphone stopped — recording is paused", "Can't save on this device — storage is full".
  - Stop asks for confirmation, then shows "Saving…" and finally "Saved on this device". Only after that come the post-stop messages:
    - "This class is 2 h 40 min. We'll process it in 2 parts — you'll still get one set of notes."
    - The allowance estimate (C5 or C6).
    - "Save a copy to this device".
- **C3. Recovery:** "We found an unfinished recording from 30 Sep, 10:05 (1 h 12 min)", with Recover, Save a copy and Discard. Discard needs a clear confirmation.
- **C4. File upload:** use Add Files for an empty class and Add More Files after its first source is added. Show each file in the list as its upload begins, with a progress bar based on transmitted bytes and elapsed time. Keep new files near the top and refresh each completed file while later files continue. Support network loss and resume, label "Received" only after server checking, and let later files continue when one file fails. Audio saved locally is labelled as device storage rather than a server upload.
- **C5. Processing estimate and confirm:** what will be processed (audio minutes, pages, photos), "Uses 46 min of 4 h 20 min", allowance left afterwards, and a Confirm button. "Nothing is sent until you confirm."
- **C6. Not enough allowance:** "This class needs 2 h 40 min. You have 1 h left." Four choices:
  - Keep for later (audio stays on this device).
  - Process a part (opens the range picker).
  - Save a copy to this device.
  - Ask the pilot operator for more.
  - No purchase options anywhere.
- **C7. Processing status:** a calm step list ("Transcribing", "Matching photos and pages", "Writing notes", "Suggesting cards") and "You can close this page — we'll keep working". Class status chips:
  - Ready to process
  - Waiting for allowance
  - In queue
  - Processing
  - Needs your action
  - Partly ready (always states exactly what is missing)
  - Ready
  - Failed (with a Retry that doesn't charge again)
  - Cancelled

### D. Study: Notes

- **D1. Notes for a class**, layered:
  1. Lesson summary and goal at the top.
  2. A table of contents.
  3. Sections, shown only when they have content: Key points, Vocabulary, Grammar, Examples from class, AI explanations, Related images, Common mistakes, Practice (with reveal-answer), Homework announced in class, Sources, and Cards from this class.
  - Every item carries its **provenance label** and **source chips** (rule 3).
  - Explanations appear in the chosen language. For experimental-quality languages, show L1 and English side by side (rule 7).
  - The partial-result banner (rule 2).
  - Speakers appear as "Speaker 1", "Speaker 2" and "Unknown". Once the learner confirms it, one speaker can show as "Teacher (confirmed by you)".
- **D2. Source reference viewer:**
  - An audio range player (local copy only), a PDF page view and a photo view.
  - "Original audio isn't on this device" and "The original file is no longer kept" states.
- **D3. Edit notes:** inline editing with an "Edited by you" marker and a simple version history. When a new generated version is suggested, show a side-by-side comparison with Keep mine, Use new and Choose per section.
- **D4. Transcript:** segments with speaker and time. The learner can fix segment text and assign or fix the speaker role, but there is no waveform editor.
- **D5. Export:**
  - **HTML notes file:** shows its approximate size and what's included, lets the learner choose images or lower their quality, and notes that it's a snapshot that won't update later.
  - **Anki package (.apkg):** choose cards, and explain the limits: "Your review history is not included. Recalino and Anki keep separate schedules."

### E. Cards

- **E1. Suggested cards** (the default is "Review before adding"):
  - A list of card previews with Add, Edit and Reject, plus bulk "Add selected".
  - Duplicate or merge suggestions.
  - A setting for **Auto add**, which only adds cards that passed quality checks.
  - Rejecting a card is not a wrong answer.
- **E2. Card types** (show the front and back of each):
  - Question/answer
  - Vocabulary (word → meaning in context, with an example)
  - Cloze ("I've ___ finished my homework.")
  - Grammar point
  - Error correction ("I have seen him yesterday." → "I saw him yesterday.")
  - Simple listening (audio first, text after Show answer)

  Cards can hold an image or audio. Computer-generated audio carries a small "Computer voice" label, distinct from class audio.
- **E3. Card actions:**
  - Edit
  - Delete (explain the effect)
  - Suspend
  - I know this
  - Important
  - Too hard (asks for a simpler explanation; this is different from the Hard rating)
  - Wrong card (report and suspend)
  - Make similar (uses allowance)
  - An **Undo** snackbar for the last non-destructive action
- **E4. Update suggestion:** when notes changed, the affected cards show a "Suggested update" to accept or ignore. Cards are never silently changed.

### F. Review

- **F1. Start review:** due cards, new cards today, estimated minutes.
  - When behind: "You have 60 cards due. We suggest pausing new cards today."
  - The learner can stop early and continue later.
- **F2. Review card:** the front, then **Show answer**, then a rating.
  - **Simple mode (the default):** "Forgot" and "Remembered".
  - **Advanced mode:** "Again", "Hard", "Good" and "Easy", with a one-time hint that "Hard means you remembered, but it was difficult."
  - Audio play button, image, progress, and an "End for now" action.
  - State: an answer **not yet saved** ("Saving… / Not saved yet — retrying"). It never shows as saved before it is.
- **F3. Session summary:** cards reviewed, time spent and what's next. No mastery percentages.

### G. Progress, settings and allowance

- **G1. Progress:**
  - Reviews over time, cards due, cards added, and topics with repeated mistakes.
  - "Your level: B1 (you said)" and "Suggested support level: around B1 (based on 40 reviews; may change)" are shown **separately**.
- **G2. Preferences:** explicit preferences, plus things Recalino learned from the learner's edits (for example "Shorter explanations"), each visible, editable and resettable.
- **G3. Settings:**
  - Profile: first language, explanation language, level and goal.
  - Time zone.
  - Review mode (Simple or Advanced).
  - New cards per day.
  - Accept updated Terms.
  - Delete a class, delete a source (three options: remove from this class, delete the original file but keep the notes, delete completely), and delete the account. Each deletion states its consequences clearly, including that already-downloaded files can't be recalled.
- **G4. Allowance:** what's left per type (class audio in hours and minutes, pages, card extras), what's in use by processing now, and the valid-until date.
  - Empty state: "You don't have a processing allowance yet. Ask the pilot operator."

### H. Global patterns

- Empty, loading (skeletons), inline error and retry states.
- An honest offline banner. The recording and recovery pages still open offline.
- An **unsupported browser** page with alternatives.
- Confirmation dialogs for destructive actions.
- **Toasts versus inline messages:** never use toasts during recording, and never use a toast as the only place important status appears.

## 9. Prototype: the core loop

Make it clickable, on mobile:

1. Today
2. New class
3. Record
4. Take a photo
5. Stop
6. "Saved on this device"
7. Estimate
8. Confirm
9. Processing
10. Notes (with source chips and provenance labels)
11. Suggested cards
12. Add selected
13. Review: Show answer and Remembered
14. Summary

Include one branch of the flow where the allowance is **not enough**.

## 10. Sample content

This content is synthetic. Use it in the mockups so the design is tested with real scripts and realistic lengths.

- **Class:** "Present perfect vs past simple", course "ESOL Entry 3", Tuesday 30 Sep 2026.
- **Sources:**
  - Class audio, 2 h 40 min (2 processing parts)
  - Two board photos
  - A worksheet PDF (4 pages)
- **Speakers:** Speaker 1 (Teacher, confirmed by you), Speaker 2, Unknown.
- **Vocabulary:** already, yet, ever, recently.
- **English explanation:** "We use *already* when something happened earlier than expected." Example from class: "I've already finished my homework." Source chip: "Class audio · 18:42".
- **L1 explanations for "already"** (use them to test the scripts):
  - Persian (RTL): «already یعنی «قبلاً» یا «تا حالا»؛ وقتی کاری زودتر از انتظار انجام شده است.»
  - Russian: «already — «уже»: действие произошло раньше, чем ожидалось.»
  - Japanese: «already は「もう」「すでに」という意味です。予想より早く起きたことを表します。»
  - Chinese (Simplified): «already 的意思是“已经”，表示事情比预期更早发生。»
  - Arabic (RTL, shown as an **Experimental quality** example): «already تعني "بالفعل" أو "مسبقًا"، وتُستخدم عندما يحدث شيء أبكر من المتوقع.»
- **Mixed bidi test:** *The word "already" یعنی قبلاً.*
- **Review:** "12 cards due · 5 new · about 15 min".
- **Allowance** (sample numbers only): "Class audio: 4 h 20 min left · valid until 31 Oct 2026".

## 11. Deliverables and handoff for Claude Code

1. **Design system:**
   - **Colour tokens** with semantic roles, in light and dark: surface, text, border, primary, focus, success, warning, danger, the three **provenance** roles (From class, AI explanation, Edited by you) and the class status roles.
   - **Typography scale** using a system font stack; state it, and show it rendering Latin, Persian/Arabic and CJK.
   - Spacing, radius, elevation and motion (including reduced-motion).
2. **Components** with all their states: default, hover, focus, active, disabled, loading and error. Include at least:
   - Buttons, text fields, a searchable language combobox and checkboxes
   - Bottom sheet and dialog, tabs and bottom navigation
   - Status chip, provenance label, source chip
   - Source row with upload progress, audio range timeline, recording controls
   - Card face variants, rating button groups
   - Banner (partial result, experimental language, offline), snackbar with Undo
   - Empty state and skeleton
3. **Screens:** every screen in section 8, at 390 × 844 and 1440 × 900, with their key states.
4. **Prototype** of the core loop (section 9).
5. **Annotations:**
   - Behaviour notes on each screen, especially the rules in section 5.
   - Accessibility notes: focus order, labels, contrast checks.
   - RTL and CJK examples.
6. **Handoff:**
   - Tokens as CSS custom properties.
   - A component inventory with names, variants and props.
   - A note of any library you assumed.
   - Prepare it so Claude Code can take it over directly.
7. **An "Assumptions and open questions" page.**

**Priority if you work in rounds:**

- **First:**
  - The design system
  - A1–A2, B1–B2, C1–C2
  - C5–C6
  - D1
  - F2
- **Then:** the rest.
