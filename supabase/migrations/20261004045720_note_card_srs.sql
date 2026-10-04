-- PRD-NOTE-03/04, CARD-05 and SRS-10: private versioned study data.
create schema note;
create schema card;
create schema srs;
revoke all on schema note, card, srs from public, anon, authenticated;
grant usage on schema note, card, srs to recalino_app;

create table note.notebook (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  session_id uuid not null unique,
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  unique(id, user_id),
  foreign key(session_id,user_id) references org.class_session(id,owner_id) on delete cascade
);
create table note.revision (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  notebook_id uuid not null,
  knowledge_version_id uuid not null references lkm.knowledge_version(id),
  revision_number integer not null check(revision_number > 0),
  model jsonb not null,
  edits jsonb not null,
  created_at timestamptz not null default now(),
  unique(notebook_id,revision_number),
  unique(id,user_id),
  foreign key(notebook_id,user_id) references note.notebook(id,user_id) on delete cascade
);
alter table note.notebook add foreign key(current_revision_id,user_id) references note.revision(id,user_id) deferrable initially deferred;
create index note_revision_notebook on note.revision(notebook_id,revision_number desc);
create table note.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  session_id uuid not null references org.class_session(id) on delete cascade,
  revision_id uuid not null references note.revision(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(revision_id)
);

create table card.learning_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  logical_key text not null,
  kind text not null check(kind in ('vocabulary','grammar','expression','concept','example')),
  created_at timestamptz not null default now(),
  unique(user_id,logical_key),
  unique(id,user_id)
);
create table card.card (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  learning_item_id uuid not null,
  template text not null check(template in ('basic','vocabulary','cloze','grammar','correction','listening')),
  front text not null check(length(front) between 1 and 20000),
  back text not null check(length(back) between 1 and 20000),
  provenance jsonb not null,
  status text not null default 'candidate' check(status in ('candidate','active','suspended','known','rejected','deleted')),
  content_version integer not null default 1 check(content_version > 0),
  important boolean not null default false,
  quality_confirmed boolean not null default false,
  front_media_id uuid,
  back_media_id uuid,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(id,user_id),
  foreign key(learning_item_id,user_id) references card.learning_item(id,user_id)
);
create unique index card_duplicate_content on card.card(user_id,dedupe_key) where deleted_at is null;
create index card_owner_status on card.card(user_id,status,created_at) where deleted_at is null;
create table card.session_link (
  card_id uuid not null,
  user_id uuid not null,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(card_id,session_id),
  foreign key(card_id,user_id) references card.card(id,user_id) on delete cascade,
  foreign key(session_id,user_id) references org.class_session(id,owner_id) on delete cascade
);
create index card_session_link_session on card.session_link(session_id,card_id);
create table card.revision (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  content_version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(card_id,content_version),
  foreign key(card_id,user_id) references card.card(id,user_id) on delete cascade
);
create table card.proposal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  note_revision_id uuid not null references note.revision(id) on delete cascade,
  front text not null,
  back text not null,
  provenance jsonb not null,
  fingerprint text not null,
  status text not null default 'pending' check(status in ('pending','applied','dismissed')),
  created_at timestamptz not null default now(),
  unique(card_id,note_revision_id),
  foreign key(card_id,user_id) references card.card(id,user_id) on delete cascade
);

create table srs.settings (
  user_id uuid primary key references acc.user_account(id) on delete cascade,
  mode text not null default 'simple' check(mode in ('simple','advanced')),
  desired_retention double precision not null default 0.9 check(desired_retention between 0.7 and 0.97),
  daily_new_limit integer not null default 5 check(daily_new_limit between 0 and 100),
  time_budget_minutes integer not null default 15 check(time_budget_minutes between 1 and 180),
  updated_at timestamptz not null default now()
);
create table srs.card_state (
  card_id uuid primary key,
  user_id uuid not null,
  version integer not null default 0 check(version >= 0),
  state jsonb not null,
  due_at timestamptz not null,
  introduced_at timestamptz,
  algorithm text not null default 'FSRS6/ts-fsrs@5.4.2',
  parameters jsonb not null,
  updated_at timestamptz not null default now(),
  foreign key(card_id,user_id) references card.card(id,user_id) on delete cascade
);
create index srs_due on srs.card_state(user_id,due_at,card_id);
create table srs.review_event (
  id uuid primary key,
  user_id uuid not null,
  card_id uuid not null,
  expected_version integer not null,
  request_hash text not null,
  rating integer not null check(rating between 1 and 4),
  mode text not null check(mode in ('simple','advanced')),
  duration_ms integer not null check(duration_ms between 0 and 3600000),
  study_day date not null,
  timezone text not null,
  is_new boolean not null,
  before_state jsonb not null,
  after_state jsonb not null,
  parameters jsonb not null,
  algorithm text not null,
  created_at timestamptz not null default now(),
  unique(card_id,expected_version),
  unique(id,user_id),
  foreign key(card_id,user_id) references card.card(id,user_id) on delete cascade
);
create index srs_event_owner_day on srs.review_event(user_id,study_day,created_at desc);
create table srs.review_undo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  review_event_id uuid not null unique,
  resulting_version integer not null,
  created_at timestamptz not null default now(),
  foreign key(review_event_id,user_id) references srs.review_event(id,user_id) on delete cascade
);

do $$ declare item record; begin
  for item in select schemaname, tablename from pg_tables where schemaname in ('note','card','srs') loop
    execute format('alter table %I.%I enable row level security',item.schemaname,item.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated',item.schemaname,item.tablename);
  end loop;
end $$;
grant select,insert,update,delete on note.notebook,card.learning_item,card.card,card.session_link,card.proposal,srs.settings,srs.card_state to recalino_app;
-- Append-only snapshots, revisions and review history; PRIV uses its own cleanup authority.
grant select,insert on note.revision,note.outbox,card.revision,srs.review_event,srs.review_undo to recalino_app;
