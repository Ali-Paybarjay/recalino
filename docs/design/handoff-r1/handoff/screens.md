# Screen map

Each screen → file and figure id (open the file, the id is the frame's badge). Behaviour notes sit under every frame in the files; key rules are repeated here.

| Brief | Screen | File | Figure ids |
|---|---|---|---|
| A1 | Welcome / sign in | Screens 1 - Setup & Today | A1-* |
| A2 | Profile setup (6 steps) | Screens 1 - Setup & Today | A2-* |
| A2.7 | Recording consent (once, in setup) | Screens 1 | A2-7 |
| A3 | Before first upload (not Record) | Screens 4 - Setup Classes Capture | A3 |
| A4 | Microphone + readiness (every Record) | Screens 4 | A4-ok, A4-ask, A4-blocked, A4-unsupported |
| B1 | Today | Screens 1 | B1-default, B1-empty, B1-states, B1-desktop |
| B2 | New class sheet / dialog | Screens 1 | B2-* |
| B3 | Classes, course page, rename/delete | Screens 4 | B3-list, B3-course, B3-options, B3-desktop |
| C1 | Class page + add sources + range | Screens 2 - Capture | C1-* |
| C2 | Recording + problems + stop | Screens 2 | C2-* |
| C3 | Recovery + discard confirm | Screens 4 | C3, C3-discard |
| C4 | File upload (offline, resumed, bad file) | Screens 4 | C4-offline, C4-resumed |
| C5 | Estimate + confirm | Screens 2 | C5-* |
| C6 | Not enough allowance | Screens 2 | C6-* |
| C7 | Processing + all status chips + failed | Screens 4 | C7-steps, C7-failed |
| D1 | Notes | Screens 3 - Notes & Review | D1-* |
| D2 | Source viewer (audio, page, unavailable) | Screens 5 - Notes Tools | D2-audio, D2-page, D2-missing |
| D3 | Edit, history, compare | Screens 5 | D3-edit, D3-history, D3-compare (desktop) |
| D4 | Transcript | Screens 5 | D4 |
| D5 | Export HTML / Anki | Screens 5 | D5-html, D5-anki |
| E1 | Suggested cards | Screens 6 - Cards Review | E1-mobile, E1-desktop |
| E2 | Card types | Screens 6 | E2-qa … E2-listen |
| E3 | Card actions, delete, undo | Screens 6 | E3-sheet, E3-delete |
| E4 | Update suggestion | Screens 6 | E4 |
| F1 | Start review (+ behind) | Screens 6 | F1, F1-behind |
| F2 | Review card | Screens 3 | F2-* |
| F3 | Session summary | Screens 6 | F3 |
| G1 | Progress | Screens 7 - Me Global | G1, G1-desktop |
| G2 | Preferences | Screens 7 | G2 |
| G3 | Settings + delete source | Screens 7 | G3, G3-delete-source |
| G4 | Allowance (+ empty) | Screens 7 | G4, G4-empty |
| H | Offline, skeleton, error, unsupported, confirm, empty, toast rules | Screens 7 | H-offline, H-unsupported, H-rules |
| §9 | Core loop prototype | Recalino Prototype | — |

## Record first (binding)

Record is the app's first and most important action. On Today (B1, all states incl. empty/offline/loading) the first block is **Record a class** — one tap starts recording (C2) at once and creates an untitled class "Class — {date}". Recording consent is asked **once**, in profile setup (A2.7) — never before a recording. Every Record tap silently checks microphone permission (A4 rules); if granted, recording starts at once. Start review on Today is secondary. "New class" (no recording) is a ghost button next to "Recent classes".

## Recording controls

Recording (C2) has **Pause / Resume** (one 96px toggle, centre), Photo and Stop. See C2-paused. Pause never ends the file; no auto-resume.

## Core loop (prototype order)

Today → **Record a class** (or New class → Class page → Record) (+ Take photo) → Stop (confirm sheet) → Saving… → **Saved on this device** → post-stop messages (2-part split, allowance) → Estimate → Confirm → Processing → Notes → Suggested cards → Add selected → Review (Show answer → Remembered/Forgot, "Saving…") → Summary → Today.

Branch (allowance 1 h, class 2 h 40): Saved → **Not enough allowance** → Keep for later (class shows "Waiting for allowance") / Process a part (range picker → estimate 1 h of 1 h → processing → notes "Partly ready · 1 h of 2 h 40 processed") / Save a copy (inline confirmation) / Ask the pilot operator (inline confirmation).

## State machines worth implementing explicitly

- **Recording:** `idle → requesting → recording ⇄ paused → stopping(confirm) → saving → saved` + `problem(micStopped | storageFull | pageHidden)`. While `recording|paused|stopping`, suppress all toasts and non-failure messages.
- **Audio source:** `onThisDevice → sending → sent → serverCopyDeleted`; viewed elsewhere → `notOnThisDevice`.
- **File source:** `uploading(n/total) → checking → received | notAccepted(reason) | needsAction(action)`; network loss → `paused`, resume automatically.
- **Class:** `readyToProcess → (waitingForAllowance) → inQueue → processing → ready | partlyReady(missing) | failed(retryFree) | cancelled`; `needsAction` from any source.
- **Review answer:** `unsaved → saving → saved | retrying` (UI never shows saved before the server ACK).
- **Notes versions:** append-only; regenerate → `suggested`; apply = new version; restore = new version.
