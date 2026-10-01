# Instructions for Claude Code — Recalino

Place this file at the root of the app repo (as `CLAUDE.md`).

1. Read `HANDOFF.md` §0 before writing any code. It is binding.
2. Do **no** independent design. All styles come from `recalino/tokens.css` + `handoff/css/nocturne-base.css` (copy verbatim, load base → tokens → app CSS) and the inline styles in the `Recalino Screens *.dc.html` files.
3. Never add colours, fonts, sizes, spacing, radii, shadows or animations not present in those files. Never add a web font.
4. All UI text from `handoff/copy.md` and the screen files, verbatim.
5. Components: `handoff/components.md`. Screens + behaviour: `handoff/screens.md`. Accessibility: `handoff/accessibility.md`. Flow: `Recalino Prototype.dc.html`.
6. If something isn't specified, build it from existing components/tokens only; if that's impossible, ask instead of guessing.
7. Icons: `@phosphor-icons/react` only.
8. Check every screen against its `.dc.html` frame at 390 px and 1440 px.
