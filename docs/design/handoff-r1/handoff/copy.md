# UI copy — exact strings

Plain English, A2–B1. Short sentences. No idioms. Keep these strings exactly; put them in one i18n file even though the UI is English-only.

## Terms (use consistently)
Class · Course · Unit · Sources · Notes · Cards · Review · Allowance. Default course: "My classes". Untitled class: "Class — 30 Sep 2026".

## Consent
- "I am 18 or older"
- "I accept the Terms and Privacy Notice"
- "I have the right to use these materials for my private study"
- "You need a Google account to join the pilot."
- Sign-in failed: "We couldn't sign you in. Please try again." (never reveals whether an account exists)

## Recording
- State: "Recording" · "Paused" · "Saving on this device"
- Problems (inline): "Microphone stopped — recording is paused" · "Can't save on this device — storage is full"
- Stop sheet: "Stop recording?" · "The recording keeps going until you choose." · "Keep recording" · "Stop and save"
- After stop: "Saving…" → "Saved on this device"
- Post-stop: "This class is 2 h 40 min. We'll process it in 2 parts — you'll still get one set of notes." · "Save a copy to this device"
- Advice: "Keep this page open and the screen on during class. Recording may stop if the phone locks or you switch apps."
- Recovery: "We found an unfinished recording from 30 Sep, 10:05 (1 h 12 min)" · "Recover recording" · "Save a copy to this device" · "Discard"

## Source statuses
Audio: "On this device" · "Sending for processing…" · "Sent for processing" · "Server copy deleted" · "Original audio isn't on this device"
Files: "Uploading 3/10" · "Checking…" · "Received" · "Not accepted" + reason · "Needs your action" + action (e.g. "Upload a copy without a password")
Unavailable: "The original audio isn't on this device." · "The original file is no longer kept."
**Never:** "Saved to your account" (for class audio).

## Class statuses
"Ready to process" · "Waiting for allowance" · "In queue" · "Processing" · "Needs your action" · "Partly ready · {what is missing}" · "Ready" · "Failed" (+ "Retry won't use your allowance again.") · "Cancelled"
Partial: "Part 2 isn't ready yet. These notes use Part 1 and the worksheet only." (never "complete notes")
Processing: "Transcribing" · "Matching photos and pages" · "Writing notes" · "Suggesting cards" · "You can close this page — we'll keep working."
Changed sources: "New sources since your notes were made" · "Update affected parts"

## Allowance
- Estimate: "This uses **46 min** of your **4 h 20 min**." · "Left afterwards: …" · "Nothing is sent until you confirm."
- Not enough: "This class needs 2 h 40 min. You have 1 h left." · "Keep for later" · "Process a part" · "Save a copy to this device" · "Ask the pilot operator for more"
- Empty: "You don't have a processing allowance yet. Ask the pilot operator."
- Meter: "Class audio: 4 h 20 min left · valid until 31 Oct 2026"

## Provenance
"From class" · "AI explanation" · "Edited by you" · "Teacher (confirmed by you)" · "Mentioned in class discussion" · "Speaker 1" / "Speaker 2" / "Unknown" · "Experimental quality" · "Report a problem" · "Computer voice"

## Recording consent (A2.7, once)
Title "Recording other people" · "When you record a class, your teacher's and classmates' voices are in the recording." · "Ask first" / "Before you record, ask your teacher and the people in your class if it is OK." · "Follow your college's rules" / "If you are not sure, ask your teacher." · "Only for your study" / "Don't share recordings with other people." · "We ask you this once. After this, we trust that you ask each time you record." · checkbox "I understand that I must ask the people in my class before I record." · "Finish setup"

## Microphone (A4-ask)
"Allow the microphone" · "Recalino needs your microphone to record the class. Your phone will ask you. Tap Allow." · "Allow microphone" · "Not now"

## Pause
"Pause" / "Resume" · status "Paused" · "Saved on this device so far" · "Nothing is recorded while paused. Tap Resume to go on." · after 30 min "Still paused"

## Today — Record
"Record a class" · helper: "Starts right away · saved on this device · name it later" · desktop: "Record your class" / "Starts right away and saves on this device. Name it later." · empty: "Record your first class. We'll help you make notes and cards from it." · "New class without recording"

## Review
"12 cards due · 5 new · about 15 min" · "Start review" · "Show answer" · Simple: "Forgot" / "Remembered" · Advanced: "Again" / "Hard" / "Good" / "Easy" · hint: "Hard means you remembered, but it was difficult." · "End for now" · "Saving…" · "Not saved yet — retrying"
Behind: "You have 60 cards due. We suggest pausing new cards today."
Summary: "Done for now" · "Cards reviewed" · "Time" · "What's next"

## Export
HTML: "This file is a snapshot. It won't update if your notes change later."
Anki: "Your review history is not included. Recalino and Anki keep separate schedules."

## Deletion
Source options: "Remove from this class" · "Delete the original, keep the notes" · "Delete completely"
Always add: "Files you already downloaded can't be recalled."
Course not empty: "You can delete a course only when it's empty. Move or delete its {n} classes first."
