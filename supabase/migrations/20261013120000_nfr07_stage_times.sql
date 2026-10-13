-- NFR-07 stage times (owner decision 2026-10-13, D71): a voice analysis records when it started
-- and finished, and a device reports the intervals its page was hidden while a class was being
-- processed. Times and identifiers only; no class content (PRD-PRIV-06).
alter table voc.analysis
  add column analysis_started_at timestamptz,
  add column analysis_finished_at timestamptz;

create table proc.foreground_gap (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  session_id uuid not null,
  hidden_at timestamptz not null,
  visible_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(session_id,user_id) references org.class_session(id,owner_id) on delete cascade,
  unique(user_id, session_id, hidden_at),
  check(visible_at >= hidden_at)
);
create index foreground_gap_session_idx on proc.foreground_gap(session_id, hidden_at);
alter table proc.foreground_gap enable row level security;
revoke all on proc.foreground_gap from public,anon,authenticated;
grant select,insert,delete on proc.foreground_gap to recalino_app;
