# Class preview verification

22 distinct affected preview browser regressions passed across the initial and targeted reruns:

- All 13 workspace scenarios passed, including class restoration, course selection, class creation/reset, course/unit organization, dated materials, and title preservation.
- The account reset scenario passed with explicit Course selection after reset.
- All 8 affected mobile/desktop render cases passed for Today, Classes, Course, and Class.

The initial run overlapped concurrent upload edits and briefly encountered missing FileSelectionQueue modules. Its first two cases passed after the modules were complete. The dated generated-material case passed after the upload owner updated that test for Upload & Process. Those upload edits were preserved.

The separate focused Chromium script passed 9 checks with no page errors:

- Multi-course entry requires a Course choice; a sole course is selected automatically.
- Collapsed rows show date/title in one line, in newest-date order.
- Keyboard activation expands a row before Go to class navigation.
- Class navigation restores the selected workspace and shows notes/flashcards first.
- Explicit All classes and course-specific lists show the correct membership.
- Course materials hash links reveal Course tools.
- Scroll loading appends 45 classes in batches without disturbing date order.
- 390px light and dark row disclosures have no horizontal overflow and no axe WCAG violations.

Scoped Biome and web TypeScript checks passed. The task-started preview dev server was stopped after verification.

Artifacts:

The raw browser runs and screenshots listed below remain local verification output and are excluded from Git. The production release summary, source audit, and public checks are versioned separately.

- `run/results.json`: focused browser checks.
- `run/desktop-collapsed.png`, `run/desktop-expanded.png`: class directory screenshots.
- `run/desktop-class-hub.png`: notes and flashcards first on class entry.
- `run/mobile-light-expanded.png`, `run/mobile-dark-expanded.png`: mobile themes.
- `run/workspace`, `run/workspace-rerun`, `run/additional`: isolated regression outputs.
