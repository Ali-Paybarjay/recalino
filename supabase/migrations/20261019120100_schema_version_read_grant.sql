-- OPS-05 (audit 2026-10-18): the job runner and the admin overview compare the newest migration of
-- the deployed code with the newest one applied here (packages/core/src/plt/schema-version.ts) and
-- pause job work while the database is behind. Without this grant the application role cannot read
-- the table and the check fails open. Only the version column is readable; the recorded
-- statements stay hidden. No data changes.
-- `supabase db push`, `supabase db reset` and `pnpm db:apply` create the table before the first
-- migration runs; a database built from these files alone (some integration tests) has none, so
-- the grant is skipped there.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    grant usage on schema supabase_migrations to recalino_app;
    grant select (version) on supabase_migrations.schema_migrations to recalino_app;
  end if;
end $$;
