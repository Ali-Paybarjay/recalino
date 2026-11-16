-- Recalino ADR-0004 rule 3, step 3 of the three-step rollout (P11-08): the database-side barrier
-- on claim. Code that does not read the barrier row (every build before P11-01) is stopped only by
-- a check the database itself enforces, so the check is a trigger on plt.job.
--
-- What this file creates, and nothing else:
--   - plt.job_claim_barrier(): the trigger function. Once active, a claim (a plt.job row that
--     becomes 'running') passes only if it wrote the current generation of
--     plt.job_lease_generation into lease_generation and a build of allowed_builds into
--     lease_build. NULL in either column is refused. A NULL or empty allowed_builds allows no
--     build at all: every claim is refused (fail-closed). The note "NULL or empty: no build
--     restriction" in 20261112120000 describes only the time before activation. Any write that
--     leaves a row not running clears both columns, so values left by an earlier claim never
--     authorize a later claim that does not write them.
--   - the trigger job_claim_barrier on plt.job, created DISABLED: applying this migration changes
--     no claim. The trigger's enabled state is the barrier's on/off state; there is no new column
--     or table.
--   - plt.activate_job_claim_barrier(allowed_builds, current_build): the owner's activation.
--   - plt.deactivate_job_claim_barrier(): the owner's way back.
-- Neither function is run by this migration or by any code path; the owner runs them per
-- docs/runbooks/JOB_LEASE_BARRIER.md. Neither is executable by public, anon, authenticated or the
-- app role. This file deletes and changes no row.
--
-- Locks: CREATE TRIGGER and ALTER TABLE ... DISABLE TRIGGER each take a SHARE ROW EXCLUSIVE lock
-- on plt.job, held to the end of the transaction. Neither rewrites or scans the table. Both run in
-- one DO block under a 3 s lock_timeout, so the migration fails instead of holding the job queue
-- behind it, and no moment exists in which the trigger is enabled. A repeated run is a no-op: the
-- functions are replaced with the same text, and an existing trigger, enabled or not, is left as
-- it is.

create or replace function plt.job_claim_barrier()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_generation integer;
  allowed text[];
begin
  if new.state = 'running' then
    -- A write on a job that was already running (renew, token rotation) is not a claim.
    if tg_op = 'UPDATE' and old.state = 'running' then
      return new;
    end if;
    select g.generation, g.allowed_builds
      into current_generation, allowed
      from plt.job_lease_generation g
      where g.singleton;
    -- Every NULL (no row, no generation, no build, no allowed set) ends in a refusal.
    if not coalesce(
      new.lease_generation = current_generation and new.lease_build = any (allowed),
      false
    ) then
      raise exception 'job claim refused by the claim barrier'
        using errcode = 'P0001',
              hint = 'ADR-0004 rule 3: a claim needs the current lease generation and an allowed build; see docs/runbooks/JOB_LEASE_BARRIER.md';
    end if;
    return new;
  end if;
  -- Not running: the row holds no claim, so it keeps no claim's generation or build.
  new.lease_generation := null;
  new.lease_build := null;
  return new;
end;
$$;

-- Activates the barrier, or changes the allowed builds of an active barrier, in one transaction:
-- validates the input, locks the barrier row and plt.job, enables the trigger, rotates the
-- lease_token of every running job, raises the generation by one and stores the allowed builds.
-- Returns the generation in force. Any invalid input raises an error and changes nothing.
-- Idempotent: when the barrier is already active with the same allowed builds (as a set), it
-- returns the current generation and changes nothing, so a repeated call raises no generation and
-- rotates no token. Security invoker: only a role that owns plt.job can enable its trigger.
create or replace function plt.activate_job_claim_barrier(allowed_builds text[], current_build text)
returns integer
language plpgsql
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  builds text[];
  stored_generation integer;
  stored_builds text[];
  active boolean;
begin
  if current_build is null or current_build = '' then
    raise exception 'job claim barrier: the current build is missing' using errcode = '22023';
  end if;
  if allowed_builds is null or cardinality(allowed_builds) = 0 then
    raise exception 'job claim barrier: the allowed build set is empty' using errcode = '22023';
  end if;
  if array_position(allowed_builds, null) is not null or '' = any (allowed_builds) then
    raise exception 'job claim barrier: the allowed build set holds an empty build'
      using errcode = '22023';
  end if;
  select array_agg(distinct b order by b) into builds from unnest(allowed_builds) as b;
  if not current_build = any (builds) then
    raise exception 'job claim barrier: the current build is not in the allowed build set'
      using errcode = '22023';
  end if;

  select g.generation, g.allowed_builds
    into stored_generation, stored_builds
    from plt.job_lease_generation g
    where g.singleton
    for update;
  if not found then
    raise exception 'job claim barrier: the lease generation row is missing' using errcode = '55000';
  end if;
  select t.tgenabled <> 'D' into active
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'plt.job'::regclass and t.tgname = 'job_claim_barrier';
  if active is null then
    raise exception 'job claim barrier: the trigger is missing' using errcode = '55000';
  end if;
  if active and (select array_agg(distinct b order by b) from unnest(stored_builds) as b) = builds then
    return stored_generation;
  end if;

  -- One lock for every change below, taken before any of them under the 3 s lock_timeout.
  lock table plt.job in share row exclusive mode;
  if not active then
    alter table plt.job enable trigger job_claim_barrier;
  end if;
  -- ADR-0004 rule 3: the raised generation rotates the token of every running job, so no token
  -- issued before this point passes any check of rule 2, in old code or new.
  update plt.job set lease_token = gen_random_uuid() where state = 'running';
  update plt.job_lease_generation g
    set generation = g.generation + 1, allowed_builds = builds, changed_at = now()
    where g.singleton;
  return stored_generation + 1;
end;
$$;

-- The way back: disables the trigger, so claims are no longer checked. Deletes and changes no row;
-- the generation and the allowed builds stay as they are. Idempotent. Security invoker, as above.
create or replace function plt.deactivate_job_claim_barrier()
returns void
language plpgsql
set search_path = ''
set lock_timeout = '3s'
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'plt.job'::regclass and t.tgname = 'job_claim_barrier'
  ) then
    raise exception 'job claim barrier: the trigger is missing' using errcode = '55000';
  end if;
  alter table plt.job disable trigger job_claim_barrier;
end;
$$;

-- Functions are executable by PUBLIC by default; these three are for the owner only. The trigger
-- fires without an EXECUTE check, so the app role's claims are unaffected by this.
revoke all on function plt.job_claim_barrier() from public, anon, authenticated, recalino_app;
revoke all on function plt.activate_job_claim_barrier(text[], text)
  from public, anon, authenticated, recalino_app;
revoke all on function plt.deactivate_job_claim_barrier()
  from public, anon, authenticated, recalino_app;

do $$
begin
  perform pg_catalog.set_config('lock_timeout', '3s', true);
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'plt.job'::regclass and t.tgname = 'job_claim_barrier'
  ) then
    create trigger job_claim_barrier
      before insert or update on plt.job
      for each row execute function plt.job_claim_barrier();
    alter table plt.job disable trigger job_claim_barrier;
  end if;
end;
$$;

/*
Down migration: documented only, never run (the Supabase CLI runs every file in this folder).
First turn the barrier off (select plt.deactivate_job_claim_barrier();), then:

  drop trigger if exists job_claim_barrier on plt.job;
  drop function if exists plt.deactivate_job_claim_barrier();
  drop function if exists plt.activate_job_claim_barrier(text[], text);
  drop function if exists plt.job_claim_barrier();

Then remove the version row 20261112130000 from supabase_migrations.schema_migrations, and set
EXPECTED_SCHEMA_VERSION back in apps/web/src/server/schema-version.generated.ts.
*/
