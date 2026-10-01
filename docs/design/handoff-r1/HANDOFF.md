# Recalino MVP — Handoff for Claude Code

Design package for the Recalino MVP UI (brief: `uploads/CLAUDE_DESIGN_BRIEF.md`).
Target: **React on Next.js**, responsive PWA, mobile-first (390 × 844) and desktop (1440 × 900).

## 0. Design fidelity — read first (binding)

**Do not design anything.** Every visual decision is already made in this package. Your job is to implement it exactly.

- **Copy, don't invent.** Use `recalino/tokens.css` and `handoff/css/nocturne-base.css` verbatim. Never add a colour, font, size, spacing, radius, shadow or duration that isn't in them.
- **The `.dc.html` files are the pixel spec.** Their markup uses inline `style="…"` attributes — open the source and lift those exact values (they reference `var(--…)` tokens). Match layout, spacing, order, icons and copy 1:1.
- **Copy text** comes from `handoff/copy.md` and the screen files, word for word (including Persian/Arabic strings).
- **Missing screen or state?** Compose it only from existing components and tokens following §3–§4; do not create new visual patterns. If that isn't possible, stop and ask — don't improvise.
- **No UI libraries that bring their own look** (MUI, Chakra, default shadcn themes, Bootstrap). Headless/unstyled primitives (Radix, React Aria) are fine.
- **Verify** each screen side-by-side against its `.dc.html` frame (390 px and 1440 px) before moving on.

## 1. What's in this package

| Path | What it is |
|---|---|
| `recalino/tokens.css` | **Source of truth for design tokens** (CSS custom properties, light + dark). Copy as-is. |
| `handoff/css/nocturne-base.css` | Base component layer (`.btn`, `.input`, `.field`, `.tag`, `.card`, `.dialog`, ramps). Web-font import removed. Load **before** `tokens.css`. |
| `handoff/components.md` | Component inventory: names, variants, props, states. |
| `handoff/screens.md` | Screen map (every brief screen → file + figure id), per-screen behaviour rules. |
| `handoff/accessibility.md` | Focus orders, ARIA patterns, live regions, contrast table (all AA pass). |
| `handoff/copy.md` | Exact UI strings for statuses, banners, consent and allowance messages. |
| `Recalino Design System.dc.html` | Visual reference for tokens, type (Latin / Persian / Arabic / CJK), components with states. |
| `Recalino Screens 1–7 *.dc.html` | All screens with key states and behaviour notes under each frame. |
| `Recalino Prototype.dc.html` | Clickable core loop (Today → … → Summary) + "not enough allowance" branch. |
| `Recalino Assumptions.dc.html` | Assumptions made + open questions for the product owner. |
| `Recalino Colour Options.dc.html` | Colour exploration; **1c "Mint & lime" was chosen** and is what tokens.css contains. |
| `recalino/archive/tokens-v0.1-indigo.css` | Previous (unused) indigo token set, for reference only. |

The `.dc.html` files open directly in a browser (they need `support.js`, `_ds/` and `recalino/` next to them — keep the folder structure). Re-implement them as React components, but treat every value in them as final: same structure, same tokens, same copy. Don't port the DC runtime (`support.js`) itself.

## 2. Setup decisions

- **Styling library: none assumed.** Plain CSS custom properties + the small class layer in `nocturne-base.css`. Works with CSS Modules, vanilla-extract or Tailwind (map tokens into `theme.extend` via `var(--…)`). If you pick Tailwind/shadcn, keep token names unchanged.
- **Load order:** `nocturne-base.css` → `recalino/tokens.css` → app CSS.
- **Theme:** put `data-theme="light|dark"` on `<html>`, set from `prefers-color-scheme` (listen for changes). Light is the primary design. Tokens also apply on `:root` (light) as a fallback.
- **Fonts:** system stack only (`--font-body`). **Never** add a web font or the Inter import. Content blocks set `lang` + `dir` so the OS chooses script fonts.
- **Icons:** Phosphor (MIT). Use `@phosphor-icons/react` (tree-shaken) — the mockups load the icon font from a CDN for convenience only; don't ship that. Weights used: regular, fill (active nav, play/pause), bold (checks).
- **Numbers:** timers, counts and durations use `.rc-num` (tabular numerals).
- **Motion:** `--rc-dur-*` + `--rc-ease`. `prefers-reduced-motion` is handled in tokens.css (durations → 0, no shimmer, no pulse).

## 3. Visual rules (option 1c "Mint & lime")

- Primary action = **filled** `.btn-primary` (deep green ink on light, mint on dark). One primary per view — on Today that is Record.
- At most **one lime hero surface** (`.rc-hero`) per screen — Today's review card and Start review. Don't use it when the learner is behind (F1-behind) or for warnings.
- Radii: buttons `--rc-btn-radius` 14px, cards `--rc-card-radius` 20px, chips 6px, source chips pill.
- Headings weight 700 (`--font-heading-weight`), body 400/500.
- Status and provenance always = **icon + text + colour** (never colour alone).
- "Cards due" is never red. No streaks, no confetti, no mastery %.

## 4. Layout rules

- **Record first:** "Record a class" is the first block and the only filled primary on Today (mobile and desktop). One tap → recording. See `handoff/screens.md` → "Record first".

- **Mobile:** bottom nav (Today, Classes, Review, Me), 52px items. Sheets slide up from the bottom. Recording = full-screen focus mode, no nav.
- **Desktop (≥ 1024px):** 248px left sidebar (wordmark, New class, nav), content column max ~840px, left-aligned. Bottom sheets become centred dialogs (480px). Lists become rows/tables. Notes reading column max 720px.
- **768–1023px:** desktop layout with the sidebar collapsed to icons.
- Drawn at 1440: B1, B2, B3, C1, D3 compare, E1, G (Me). Other screens follow the rules above.

## 5. Non-negotiable product rules → implementation

1. **Recording is never interrupted.** No toasts/modals/sounds while `recording` is true; queue post-stop messages. Real failures (mic stopped, save failed) show **inline** immediately. The "Recording" label is driven by the actual MediaRecorder + IndexedDB write state, not by UI intent.
2. **Truthful status words.** "Saved on this device" only after the IndexedDB transaction commits. "Sent for processing" only after the server ACK. "Received" only after the server check. See `handoff/copy.md` for the full state → string map.
3. **Provenance always visible.** Every note/card item has `provenance: 'class' | 'ai' | 'edited'` and ≥1 `SourceRef` when `class`. "Teacher" requires audio evidence **and** a learner-confirmed speaker role; otherwise "Mentioned in class discussion".
4. **Audio stays on device.** Source chips check local availability; on other devices show "The original audio isn't on this device." Deleted originals: "The original file is no longer kept." Never render a broken link.
5. **Consent checkboxes never pre-checked**; the gated action is disabled until checked. **Recording consent** ("ask the people in my class first") is collected **once per account** in profile setup (A2.7) and stored on the profile; it is never asked again before a recording.
5a. **Microphone permission is checked on every Record tap** and monitored during recording (A4 / C2-mic rules). Granted → start immediately.
5b. **Pause / Resume** is always available while recording (C2-paused).
6. **Allowance:** always show estimate vs. remaining before sending; nothing is sent before Confirm. No prices/plans/payment anywhere.
7. **Any script:** each content block has its own `dir`/`lang`; mixed inline text uses `<bdi>`. Experimental languages show L1 + English side by side with a label and "Report a problem".
8. **Learner in control:** regenerating creates a new suggested version (append-only history), compare + choose per section.
9. **Honest progress:** backlog visible; self-reported level and estimated support level shown separately with evidence count.
10. **WCAG 2.2 AA:** see `handoff/accessibility.md`.

## 6. Suggested build order

1. Tokens + base CSS + theme switching + icon package.
2. Primitives: Button, IconButton, Field/Input, Checkbox, Switch, SegmentedControl, Chip family (StatusChip, ProvenanceLabel, SourceChip), Banner, Sheet/Dialog, Snackbar, Skeleton, EmptyState.
3. App shell: BottomNav / Sidebar, page header.
4. Core loop screens in prototype order (B1 → B2 → C1 → C2 → C5/C6 → C7 → D1 → E1 → F2 → F3), then the rest.

## 7. Out of scope (don't build, not even "coming soon")

Library/EPUB reader, book translation, "Ask my class" chat, teacher/org accounts, sharing, social/leaderboards, under-18 users, native apps, live transcription/AI, pronunciation scoring, AI images, Anki import/sync, fully offline review, pricing/plans/payment, video recording.
