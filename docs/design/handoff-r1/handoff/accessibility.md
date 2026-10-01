# Accessibility — WCAG 2.2 AA

## Global

- Focus: `:focus-visible { outline: 2px solid var(--rc-focus); outline-offset: 2px }` on every interactive element (in tokens.css). On the lime hero the ring switches to `--rc-hero-text`.
- Targets ≥ 44 × 44 (chips: 32px visual inside a 44px hit area). Recording controls 72px.
- Every control has a visible label or `aria-label`; icon-only buttons always have `aria-label`.
- Reduced motion: tokens.css zeroes durations and stops pulse/shimmer.
- Language/direction: each content block sets `lang` and `dir` (`dir="auto"` when unknown). Mixed inline text uses `<bdi>`. RTL blocks right-align inside the LTR UI.
- Colour is never the only signal: chips = icon + text; edited content also has a dashed border; diffs use `<del>`/strike and a left rule; allowance "in use" is hatched.
- Language level: UI copy aims at A2–B1 (short sentences, common words). See `copy.md`.

## Live regions

| Where | Role | Announces |
|---|---|---|
| Recording state (C2) | `status` (polite) | Recording / Paused. Problems use `alert` (assertive) but are inline, silent, no modal. |
| Save state after Stop | `status` | "Saving…" → "Saved on this device". |
| Upload rows (C4) | `status` per row, throttled | Received / Not accepted + reason. |
| Processing steps (C7) | `status` (polite) | Step changes only. |
| Review save (F2) | `status` | "Saving…", "Not saved yet — retrying". |
| Banners | `status`; real failures `alert` | Offline, partial result, new sources. |
| Snackbar | `status` | Message + Undo is focusable. |

## Focus order (key screens)

- **A1 Welcome:** wordmark (not focusable) → 18+ checkbox → Terms checkbox (with links) → Continue with Google → help text link.
- **B1 Today:** skip link → **Record a class** → Start review → New class → each class row → bottom nav.
- **B2 / any sheet or dialog:** focus moves to the title (or first field); trap inside; Esc closes; focus returns to the trigger.
- **A2.7 Consent:** heading → three points → checkbox → Finish setup (aria-disabled with reason until checked).
- **C2 Recording:** status (read on entry) → Take photo → Pause/Resume (`aria-pressed`, label switches "Pause recording"/"Resume recording"; status announces "Paused"/"Recording") → Stop. Stop confirm sheet: focus on "Keep recording" first.
- **C5 Estimate:** heading → what will be processed (list) → allowance sentence → Confirm.
- **C6 Not enough:** heading → message → 4 options in order (Keep for later, Process a part, Save a copy, Ask).
- **D1 Notes:** banner → title → contents chips → sections (h2) → items: provenance label → text → source chips.
- **D3 Compare (desktop):** mode radiogroup → Apply → for each section: section name → "Keep mine" radio → "Use new" radio.
- **E1 Suggested cards:** Auto add switch → each card (checkbox, Edit, Reject) → Select all → Add selected.
- **F2 Review card:** End for now → progress → card (front, then back) → Show answer → rating buttons.
- **Destructive confirm:** title → consequences → safe action (focused) → destructive action.

## Contrast (computed, WCAG 2.x relative luminance)

All text pairs pass AA (4.5:1).

### Light
| Foreground | Background | Ratio |
|---|---|---|
| text `#13261f` | bg `#eef9f3` | 14.70:1 |
| text `#13261f` | surface `#fbfffd` | 15.72:1 |
| muted `#4a6259` | bg `#eef9f3` | 6.12:1 |
| muted `#4a6259` | surface `#fbfffd` | 6.54:1 |
| accent `#0d7556` | bg `#eef9f3` | 5.27:1 |
| accent `#0d7556` | surface `#fbfffd` | 5.63:1 |
| primary-text `#0a5540` | primary-tint `#d3f4e5` | 7.48:1 |
| cta-text `#eef9f3` | cta-bg `#13261f` | 14.70:1 |
| hero-text `#13261f` | hero-bg `#b9f06b` | 11.88:1 |
| hero-muted `#2f4a1a` | hero-bg `#b9f06b` | 7.44:1 |
| success `#1f6b3a` | success-tint `#dff3e4` | 5.61:1 |
| warning `#7d5510` | warning-tint `#fbf0d6` | 5.83:1 |
| danger `#a1352d` | danger-tint `#fbe6e2` | 5.72:1 |
| info `#4a6259` | info-tint `#e3efe9` | 5.59:1 |
| prov-class `#8c2f6a` | prov-class-tint `#fbe6f1` | 6.48:1 |
| prov-ai `#5d4bb0` | prov-ai-tint `#eeebfc` | 5.78:1 |
| prov-edit `#2b5a8e` | prov-edit-tint `#e4edf9` | 6.02:1 |
| tag `#effbf5` | accent-800 `#0b5a43` | 7.74:1 |

### Dark
| Foreground | Background | Ratio |
|---|---|---|
| text `#e8f3ee` | bg `#0f1a16` | 15.67:1 |
| text `#e8f3ee` | surface `#17251f` | 14.00:1 |
| muted `#a9c2b8` | bg `#0f1a16` | 9.41:1 |
| accent `#5fd6a8` | bg `#0f1a16` | 9.89:1 |
| primary-text `#b5f0d6` | primary-tint `#163a2d` | 9.78:1 |
| cta-text `#0f1a16` | cta-bg `#5fd6a8` | 9.89:1 |
| success `#8fd8a3` | success-tint `#17301f` | 8.46:1 |
| warning `#ecc275` | warning-tint `#33291a` | 8.51:1 |
| danger `#f09a90` | danger-tint `#3b2124` | 6.81:1 |
| prov-class `#f2a6cf` | prov-class-tint `#3a1b2c` | 8.11:1 |
| prov-ai `#b9adfc` | prov-ai-tint `#24223a` | 7.65:1 |
| prov-edit `#94bdf0` | prov-edit-tint `#1b2a3e` | 7.46:1 |

Non-text: focus ring and switch-on track (`#0d7556` on `#eef9f3`, 5.27:1) exceed 3:1.
