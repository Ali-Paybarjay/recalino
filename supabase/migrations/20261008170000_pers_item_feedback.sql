-- D49, 2026-10-08. Learner corrections of Recalino's practice notes about one learning goal.
-- Append-only: the latest row per goal and kind is current; earlier rows explain the change.
create schema if not exists pers;
revoke all on schema pers from public, anon, authenticated;
grant usage on schema pers to recalino_app;

create table pers.item_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  learning_item_id uuid not null,
  -- The class the goal belongs to; lets class deletion clean feedback without reading card data.
  session_id uuid,
  kind text not null check (kind in ('not_a_difficulty', 'explain_simpler')),
  active boolean not null,
  -- Server review order of the goal's latest answer when the learner gave this feedback.
  -- A later Again re-opens a dismissed practice note; older evidence never does.
  evidence_order bigint check (evidence_order is null or evidence_order >= 0),
  operation_key text not null check (char_length(operation_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, operation_key),
  foreign key (learning_item_id, user_id) references card.learning_item(id, user_id) on delete cascade
);
create index pers_item_feedback_current_idx
  on pers.item_feedback (user_id, learning_item_id, kind, created_at desc);
create index pers_item_feedback_session_idx on pers.item_feedback (user_id, session_id)
  where session_id is not null;

alter table pers.item_feedback enable row level security;
revoke all on all tables in schema pers from public, anon, authenticated;
-- Corrections are added, never rewritten; PRIV cleanup deletes them on class or account removal.
grant select, insert, delete on pers.item_feedback to recalino_app;
