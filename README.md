# Recalino

Recalino is a class-based learning space: the materials of each English class session become a documented lesson note, multimedia cards, and a daily FSRS review. The product source of truth is a structured, versioned knowledge model; review scheduling, quota and access control are deterministic code, never an LLM.

**Status:** MVP under development for a pilot. Public deployment, new paid services and destructive work on real data need the product owner's explicit approval; see [CLAUDE.md](CLAUDE.md) for the current state and the open decisions.

## Requirements

- Node.js 24 (`.nvmrc`) and pnpm 12 (`packageManager` in `package.json`)
- Docker, for the local Supabase stack (Postgres 17 and Auth)

## Run it locally

```bash
pnpm install
pnpm db:start     # local Supabase in Docker
pnpm db:env       # writes the local connection and keys to apps/web/.env.local
pnpm dev          # http://localhost:3000
```

Before a commit, run `pnpm verify` (lint, typecheck, module boundaries, unit and integration tests; the integration tests need `pnpm db:start`). For a UI change also run `pnpm test:e2e`. CI is deliberately low-cost: it runs only on `main`, pull requests to `main` and manual runs, so run these locally first ([CI policy](docs/ops/CI_LOW_COST_POLICY.md)).

## Where things are

| Path | What |
|---|---|
| `apps/web/` | Next.js app: pages, API routes, job runner (`src/app`, `src/server`, `src/ui`) |
| `packages/core/` | Domain logic, one folder per module; no Next.js or React |
| `supabase/migrations/` | The only way the database schema changes |
| `docs/` | PRD-derived requirements, ADRs, runbooks, design handoff |

Start with [CLAUDE.md](CLAUDE.md) (rules, product constants, commands) and [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) (commands, repository layout, code style, test strategy, boundaries). The product reference is [PRD_Recalino_FA_v0.3.md](PRD_Recalino_FA_v0.3.md); later product decisions are in [docs/PRODUCT_DECISIONS_LOG.md](docs/PRODUCT_DECISIONS_LOG.md).

## فارسی

ریکالینو (Recalino) فضای یادگیری مبتنی بر کلاس است: منابع هر جلسه کلاس انگلیسی به جزوه مستند، کارت‌های چندرسانه‌ای و مرور روزانه با FSRS تبدیل می‌شود. پیش‌نیازها Node 24، pnpm 12 و Docker (برای Supabase محلی) هستند. دستورهای بالا را از ریشه مخزن اجرا کنید. قواعد کار، تصمیم‌های مصوب و وضعیت فعلی در [CLAUDE.md](CLAUDE.md) و [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) است؛ هر دو فارسی‌اند. کد، شناسه‌ها و پیام commit انگلیسی‌اند.
