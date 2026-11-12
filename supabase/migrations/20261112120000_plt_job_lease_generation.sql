-- Recalino ADR-0004 (job lease fencing), rules 2 and 3, step 1 of the three-step rollout (P11-09).
-- Additive only, so the code already deployed keeps working: the schema guard sees the database
-- "ahead" (packages/core/src/plt/schema-version.ts) and claim, renew, sweep, complete and fail
-- leave the two new plt.job columns NULL.
--   - plt.job_lease_generation: one row holding the current lease generation, the set of builds
--     allowed to claim, and when that row last changed (database clock).
--   - plt.job.lease_generation and plt.job.lease_build: the generation and build of a job's
--     current claim. Nothing writes them yet: the claim fills the generation from P11-01, and the
--     build from P11-08. P11-08 also adds the database-side check on claim.
-- This migration adds no constraint, default, index or trigger on plt.job, rewrites no plt.job row
-- and raises no generation. Its only constraint is the one that keeps the new table to one row,
-- and its only data is that row.
-- A repeated run is a no-op: the table, the columns and the row are created only when missing;
-- enabling row level security, revoking and granting are idempotent; there is no policy.

create table if not exists plt.job_lease_generation (
  -- The single row: the primary key and the check together make a second row impossible.
  singleton boolean primary key default true check (singleton),
  -- Raised by one only at cutover (rule 3), never by the application.
  generation integer not null,
  -- Builds allowed to claim. NULL or empty: no build restriction. Read from P11-08 on.
  allowed_builds text[],
  changed_at timestamptz not null default now()
);

insert into plt.job_lease_generation (singleton, generation, allowed_builds)
values (true, 1, null)
on conflict (singleton) do nothing;

-- Nullable, without a default: existing rows keep NULL and are not rewritten.
alter table plt.job add column if not exists lease_generation integer;
alter table plt.job add column if not exists lease_build text;

-- Row level security with no policies: browser roles get nothing (ADR-0002); recalino_app has
-- BYPASSRLS and may only read the row, which the claim does from P11-01 on. The new plt.job
-- columns are covered by the existing table grant; no column grant is added.
alter table plt.job_lease_generation enable row level security;
revoke all on plt.job_lease_generation from public, anon, authenticated;
grant select on plt.job_lease_generation to recalino_app;

/*
Down migration: documented only, never run (the Supabase CLI runs every file in this folder).
Reverting is safe only before the P11-01 code is deployed: from then on every claim writes
plt.job.lease_generation, and the deployed code needs the column and the singleton row.
P11-08's constraint or trigger must be removed first if it exists.

  alter table plt.job drop column if exists lease_build;
  alter table plt.job drop column if exists lease_generation;
  drop table if exists plt.job_lease_generation;

Then remove the version row 20261112120000 from supabase_migrations.schema_migrations, and set
EXPECTED_SCHEMA_VERSION back in apps/web/src/server/schema-version.generated.ts.
*/
