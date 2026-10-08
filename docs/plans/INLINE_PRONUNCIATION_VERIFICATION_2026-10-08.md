# Inline pronunciation delivery — 8 October 2026

Branch: `codex/pronunciation-speakers`.
Production baseline inspected before implementation: `83e51f4cc2e30435a16ae691a6ddc1acb5a9bf30`.
Workspace: `C:/Users/Ali-PC/.codex/worktrees/pronunciation-speakers/Recalino`.

## Result

Recall places an accessible 44px speaker beside the revealed lexical target. Class Notes places the same control beside eligible published learning items, including structured older notes without the newer `classNotes` layout. Notes can request speech without a flashcard.

The notes request contains only an item ID and expected current revision. The server verifies account/class/notebook ownership and version, then derives the target from saved structured content. It uses the existing pronunciation provider, private cache, voice, quota and request-key contract. Opening notes or a card creates no speech request. Replay and retries for an already known asset do not create a second generation.

Notes retain an opaque sandbox. A nonce-authorized, fixed application bridge can send only a validated item ID through its per-document channel. The parent checks the exact frame Window and eligible item ID. Signed media URLs stay in the parent. Theme reloads restore playback state. Static downloads/Anki remain passive. Model text is escaped data.

Switching the selected word/card/revision or leaving the player aborts polling and pauses audio. Starting pronunciation pauses other audio in the current study Panel. Native controls appear if autoplay is rejected. Loading/error/ready messages have their own row so they do not squeeze the English headword on mobile.

No database migration, dependency, new paid provider, model migration or cloud configuration change was needed. No live AI call, remote write, merge or deployment was performed.

## Independent Claude Code briefs

- [Voice profile and confirmation](CLAUDE_CODE_VOICE_PROFILE_AND_CONFIRMATION_FA.md).
- [Adaptive teacher and learner memory](CLAUDE_CODE_ADAPTIVE_TEACHER_AND_LEARNER_MEMORY_FA.md).

Complete user-facing copies are saved under `D:/Claude Projects/Recalino/artifacts/briefs/2026-10-08/`. Each brief documents inspected facts, uncertainty, a proposed design, independent investigation, implementation phases, cost/privacy constraints, acceptance criteria and verification. Those capabilities are separate future Claude Code tasks.

## Verification

Node 24.19.0; pnpm 12.4.2. Provider/media/browser fixtures are synthetic. Integration uses the dedicated local stack `recalino-pronunciation-speakers`, DB port 55422 and pooler port 55429. The other shared stacks and cloud database are untouched.

- Focused unit run: **76 passed**, covering notes authorization and target derivation, existing card targets, renderer safety, iframe message validation and standalone export preservation.
- Final browser run: **43 passed, 0 failed**, serial Chromium, rounded CLI duration **1.8 minutes**. It includes 23 pronunciation/legacy cases and 20 existing study/multilingual cases. Original navigation, theme and print assertions were preserved. Receipt: `artifacts/verification/pronunciation-browser-results.json`.
- `pnpm verify`: **passed**, **2762 tests passed, 1 skipped**, **267 files passed, 1 skipped**, duration **993.61 seconds**. The existing opt-in native backup drill (`packages/ops-cli/src/backup-native.int.test.ts`, `RUN_NATIVE_BACKUP_DRILL`) was not enabled or changed. No failing test was skipped. Log: `artifacts/verification/pronunciation-verify.log`.
- Latest browser-facing source also passed a fresh 76-test focused unit run, web `tsc --noEmit`, and targeted full Biome checks after the navigation/fallback adjustments.
- `pnpm build`: **passed**, including web TypeScript and native runtime/packaging checks. Native audio/canvas/PDF/sharp checks passed; the voice runtime loaded. Acoustic model weights are optional for this local build and were not provisioned or downloaded. Log: `artifacts/verification/pronunciation-build.log`.
- `pnpm check:client-bundle`: **passed**, no secrets in client-visible output. Log: `artifacts/verification/pronunciation-client-bundle.log`.

Browser command:

```powershell
pnpm --filter @recalino/web exec playwright test --config ../../artifacts/verification/pronunciation-playwright.config.ts e2e/class-notes-pronunciation.spec.ts e2e/recall-pronunciation.spec.ts e2e/reference-study.spec.ts e2e/multilingual-study.spec.ts
```

The ignored browser config uses `http://localhost:3046`, Chromium, one worker and this worktree's dev server. An initial `127.0.0.1` dev-origin run failed hydration; switching the local fixture origin to Next's allowed localhost origin resolved it without changing tracked application configuration. Early screenshots exposed post-playback title wrapping and bottom-navigation occlusion of native fallback controls; both were corrected. Final cases verify placement after status updates and a real hit-test on the unobstructed native Play point. The fixed `about:srcdoc` base and detached empty status preserve internal navigation; CSP permits only the non-network `about:` base scheme. Prior failures were preserved under `artifacts/verification/pronunciation-failures/`.

Final project commands:

```powershell
$env:LOCAL_TEST_APP_DATABASE_URL = 'postgresql://recalino_app:recalino-local-only@127.0.0.1:55422/postgres'
$env:LOCAL_TEST_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres'
$env:LOCAL_TEST_POOLER_DATABASE_URL = 'postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:55429/postgres'
$env:VITEST_MAX_WORKERS = '1'
pnpm verify
pnpm build
pnpm check:client-bundle
```

Ignored logs and screenshots live in `artifacts/verification/`; they contain only synthetic test content. Browser tests validate playback wiring and lifecycle with mocked media, not new acoustic quality or a live paid provider. The existing pronunciation engine and voice are unchanged.

## Release boundary

History/read-only revisions and items without a valid saved lexical target remain passive. Stale current revisions return an explicit reload message rather than speaking newer content for an older visible item. Synthetic English pronunciation is separate from recognizing or evaluating the learner's own voice.

The change is prepared for review on its own branch. The dedicated development server was stopped after browser verification, and only the identified `recalino-pronunciation-speakers` local database stack was stopped after verification/build, with its backup retained. Publishing to the online application requires a separate final approval under `PROJECT_SPEC.md` section 9. Rollback is to restore the prior application commit; there is no schema migration or data rewrite to reverse.
