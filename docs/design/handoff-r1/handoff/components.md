# Component inventory

Framework-agnostic names and props (TypeScript-style). All states: default, hover, focus-visible (2px `--rc-focus` ring, 2px offset), active/pressed, disabled (45% opacity + `aria-disabled` with a reason when useful), loading, error. Min hit target 44 × 44 (`--rc-target`); recording controls 72 × 72 (`--rc-target-lg`).

Reference: `Recalino Design System.dc.html` (sections 4–7) and the screen files.

## Actions

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'md' \| 'lg'` (44 / 52–56px), `icon?`, `loading?`, `disabled?`, `block?` | Primary = filled `--rc-cta-bg`. Danger = secondary with `--rc-danger` text + `--rc-danger-border`. Loading keeps width, swaps icon for spinner, sets `aria-busy`. |
| `IconButton` | `icon`, `label` (required, → `aria-label`), `variant` | 44 × 44. |
| `RecordControl` | `kind: 'photo' \| 'pause' \| 'resume' \| 'stop'`, `onPress` | 72px circle + visible text label below. Stop = primary. |

## Inputs

| Component | Props | Notes |
|---|---|---|
| `Field` | `label`, `hint?`, `error?`, `children` | Label always visible. Error text below with icon, linked by `aria-describedby`. |
| `TextInput` / `TextArea` | standard + `dir?` | Font-size ≥ 16px on mobile (prevents iOS zoom). |
| `Checkbox` | `checked`, `label`, `required?` | Never pre-checked for consent. 24px box, whole row clickable. |
| `Switch` | `checked`, `label` | `role="switch"`, 48 × 28. |
| `SegmentedControl` | `options[]`, `value` | `role="radiogroup"`. Used for review mode, export type, image quality, compare mode. |
| `RadioCard` | `title`, `description`, `checked` | Used for delete-source options (G3), explanation language (A2). No default selection. |
| `LanguageCombobox` | `value`, `onChange`, `languages: {code, englishName, nativeName, experimental}[]` | Searchable by English or native name. Shows "Persian — فارسی". Experimental → badge + one-sentence note. ARIA 1.2 combobox pattern. |
| `Stepper` | `value`, `min`, `max`, `label` | New cards per day. |

## Status and provenance

| Component | Props | Notes |
|---|---|---|
| `ClassStatusChip` | `status: 'readyToProcess' \| 'waitingForAllowance' \| 'inQueue' \| 'processing' \| 'needsAction' \| 'partlyReady' \| 'ready' \| 'failed' \| 'cancelled'`, `detail?` | Icon + text. `partlyReady` **requires** `detail` (what's missing). Colours: info / warning / info / primary / warning / primary / success / danger / info. |
| `SourceStatus` | `status: 'onThisDevice' \| 'sending' \| 'sent' \| 'serverCopyDeleted' \| 'notOnThisDevice' \| 'uploading' \| 'checking' \| 'received' \| 'notAccepted' \| 'needsAction'`, `progress?`, `reason?` | Strings in `copy.md`. |
| `ProvenanceLabel` | `kind: 'class' \| 'ai' \| 'edited'`, `detail?` (e.g. "Teacher (confirmed by you)", date) | class = plum `--rc-prov-class` + chalkboard icon; ai = violet + lightbulb; edited = blue + pencil-line, **dashed** border on its block. |
| `ProvenanceBlock` | `kind`, `children`, `lang?`, `dir?` | Tinted container for AI and edited content; class content sits on the page with its label. |
| `SourceChip` | `ref: {type: 'audio' \| 'page' \| 'photo', label, start?, end?, page?}`, `availability: 'available' \| 'notOnDevice' \| 'notKept'` | Pill, 32px visual / 44px hit. Unavailable → dashed border + different icon, still focusable, opens explanation (D2). |
| `ExperimentalBadge` | — | Warning tint + flask icon + "Experimental quality". |

## Lists and rows

| Component | Props | Notes |
|---|---|---|
| `ClassRow` | `title`, `course`, `date`, `status` | Whole row is one link; chip text is part of the accessible name. |
| `CourseRow` | `name`, `classCount`, `unitCount`, `isDefault` | Default "My classes" can't be deleted. |
| `SourceRow` | `type`, `name`, `role`, `status`, `included`, `onRoleChange`, `onIncludeChange`, `progress?` | Role menu: Class audio / Board photo / Class material / My notes. Include = Switch. |
| `UploadRow` | `file`, `status`, `progress`, `reason?`, `actions?` | One bad file never blocks others. Paused progress = neutral colour. |
| `StepList` | `steps: {label, state: 'done' \| 'current' \| 'todo', detail?}[]` | Processing (C7). `aria-current="step"`, polite live region. |
| `CheckList` | `items: {label, result, state: 'ok' \| 'warn' \| 'fail' \| 'checking'}[]` | A4 readiness. |
| `VersionList` | `versions[]` | D3 history, append-only. |
| `TranscriptSegment` | `time`, `speaker`, `text`, `editing?` | D4. Speaker menu: Teacher (confirm) / Speaker n / Unknown. |

## Cards and review

| Component | Props | Notes |
|---|---|---|
| `CardPreview` | `card`, `selected`, `duplicateOf?` | E1 list item. Duplicate → warning block with Merge / Keep both / Skip. |
| `CardFace` | `type: 'qa' \| 'vocab' \| 'cloze' \| 'grammar' \| 'error' \| 'listening'`, `side: 'front' \| 'back'`, `image?`, `audio?: {source: 'class' \| 'tts'}` | TTS audio shows "Computer voice". Listening hides text until Show answer. |
| `RatingGroup` | `mode: 'simple' \| 'advanced'`, `onRate`, `saving` | Simple: Forgot / Remembered. Advanced: Again / Hard / Good / Easy + one-time hint. Disabled while saving. |
| `SaveIndicator` | `state: 'saving' \| 'saved' \| 'retrying'` | "Saving…" / "Last answer saved" / "Not saved yet — retrying". Never "saved" before ACK. |
| `CardActionSheet` | `card`, `extrasLeft` | Edit, I know this, Important, Too hard, Make similar (shows cost), Suspend, Wrong card, Delete. |
| `UpdateSuggestion` | `before`, `after` | E4. Accept / Ignore. `<del>` + left rule diff. |

## Surfaces and feedback

| Component | Props | Notes |
|---|---|---|
| `HeroCard` (`.rc-hero`) | `children` | Lime. Max one per screen. |
| `Banner` | `tone: 'info' \| 'primary' \| 'warning' \| 'success' \| 'danger'`, `icon`, `title?`, `children`, `action?` | Partial result, new sources, offline, back online, updated Terms, experimental language. `role="status"` (or `alert` for real failures). |
| `BottomSheet` | `title`, `onClose`, `children` | Mobile. Grab handle, focus trap, Esc/close button, returns focus. |
| `Dialog` / `ConfirmDialog` | `title`, `consequences: string[]`, `confirmLabel`, `safeLabel`, `requireAck?` | Destructive confirms list every consequence; focus starts on the safe action. `requireAck` adds "I understand this can't be undone" (only for un-sent audio). |
| `Snackbar` | `message`, `undo?` | Bottom, 8s, pauses on hover/focus. **Never during recording**, never the only status signal. |
| `Skeleton` | `shape` | Static blocks; shimmer only without reduced-motion. `aria-busy` on the container. |
| `EmptyState` | `icon`, `text`, `action` | One sentence + one action. |
| `InlineError` | `title`, `text`, `onRetry` | `role="alert"`. |
| `AllowanceMeter` | `type`, `left`, `inUse?`, `total` | In-use segment is hatched (pattern + colour). |
| `AudioRangePlayer` | `src (local)`, `start`, `end`, `transcript?` | Never autoplays. ±5s, "Play more context". |
| `RangeTimeline` | `duration`, `ranges[]`, `max?` | C1 / C6 "process a part". Keyboard: arrow keys move handles by 10s, Shift = 1 min. |

## Navigation

| Component | Props | Notes |
|---|---|---|
| `BottomNav` | `active: 'today' \| 'classes' \| 'review' \| 'me'`, `badges?` | Active = fill icon + accent + weight 600; `aria-current="page"`. |
| `Sidebar` | same | Desktop. Includes New class (secondary). |
| `RecordEntry` | `variant: 'mobile' \| 'desktop'`, `onRecord` | First block on Today. Mobile: 72px filled primary "Record a class" + helper line. Desktop: surface panel with 60px primary. The only filled primary on Today. |
| `Tabs` | `tabs[]`, `active` | Class page: Notes · Cards n · Sources · Transcript. |
| `ContentsChips` | `sections[]` | D1 table of contents; moves focus to the section heading. |
