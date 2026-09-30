-- M0 baseline (ADR-0002): least-privilege application role and a closed `public` schema.

-- The server connects as this role. It is not a superuser and gets access only to module
-- schemas, which later migrations grant explicitly. BYPASSRLS keeps row level security as a
-- second layer against the browser roles (anon, authenticated) without blocking the server.
-- The password is never set in a migration: the owner sets it once in the cloud project, and
-- seed.sql sets a local-only one.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'recalino_app') then
    create role recalino_app login bypassrls;
  end if;
end
$$;

-- Nothing is exposed through the Data API: `public` stays empty and closed to browser roles.
revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
