<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Recalino app notes

Rules for this app (full rules: root `CLAUDE.md` and `docs/PROJECT_SPEC.md`). This section is ours; the block above is generated.

- `src/app/`: App Router pages and `api/**/route.ts`. A route file stays thin: `defineRoute(ROUTES.x, handler)` from `src/server/api`. Every API route is registered in `src/server/routes.ts`; the coverage test fails for an unregistered route and for a learner route without a cross-account test.
- `src/server/`: server-only code: handlers (`*-routes.ts`), `api.ts` (authentication, ownership check, rate limit, idempotency key), the job runner, storage and provider wiring. Domain logic lives in `packages/core`; import it through its public entry points (`@recalino/core/<module>`), not through module internals.
- `src/ui/`: shared UI. All interface text comes from `strings.ts` or the existing `*-copy.ts` files (`strings.test.ts` checks the origin of each string); icons only from `icons.ts`; styles only from the existing tokens in `styles/` (no new colors, fonts, sizes or shadows, and never a web font). `/dev/ui` shows every component in every state and answers 404 in production.
- Tests sit beside the code: `*.test.ts` run without a database, `*.int.test.ts` need `pnpm db:start`, and Playwright specs are in `e2e/`.
- Environment variable names live in the root `.env.example` (names only) and are server-only; `tools/env-example.test.ts` fails when code reads a name that is not listed.
