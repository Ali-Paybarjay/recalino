-- Owner-approved admin communications and learner feedback. Private server-side schema.
create schema support;
revoke all on schema support from public, anon, authenticated;
grant usage on schema support to recalino_app;

create table support.thread (
  id uuid primary key,
  user_id uuid not null references acc.user_account(id) on delete cascade,
  operation_key text not null,
  request_hash text not null,
  category text not null check (category in ('question','problem','suggestion','other')),
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'awaiting_reply' check (status in ('awaiting_reply','replied','closed')),
  email_notification boolean not null,
  context jsonb,
  read_at timestamptz,
  last_admin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, operation_key)
);
create index support_thread_user_idx on support.thread(user_id, updated_at desc);
create index support_thread_status_idx on support.thread(status, updated_at desc);
create table support.message (
  id uuid primary key,
  thread_id uuid not null references support.thread(id) on delete cascade,
  author text not null check (author in ('learner','admin')),
  actor_id text not null,
  operation_key text not null,
  request_hash text not null,
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  unique(thread_id, operation_key)
);
create index support_message_thread_idx on support.message(thread_id, created_at);
create table support.reply_draft (
  id uuid primary key,
  thread_id uuid not null references support.thread(id) on delete cascade,
  actor_id text not null,
  operation_key text not null,
  request_hash text not null,
  revision integer not null default 1,
  body text not null,
  language text not null check(language in ('en','fa')),
  source text not null check(source in ('routine','manual')),
  state text not null default 'draft' check(state in ('draft','approved')),
  approved_at timestamptz,
  approved_message_id uuid references support.message(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(actor_id, operation_key)
);
create index support_reply_thread_idx on support.reply_draft(thread_id);
create table support.email_draft (
  id uuid primary key,
  actor_id text not null,
  operation_key text not null,
  request_hash text not null,
  revision integer not null default 1,
  state text not null default 'draft' check(state in ('draft','approved')),
  template_id text not null,
  template_version text not null,
  input jsonb not null,
  recipients jsonb not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(actor_id, operation_key)
);
create table support.email_outbox (
  id uuid primary key,
  draft_id uuid references support.email_draft(id) on delete set null,
  thread_id uuid references support.thread(id) on delete cascade,
  user_id uuid references acc.user_account(id) on delete cascade,
  purpose_key text not null unique,
  template_id text not null,
  email text not null,
  subject text not null,
  body text not null,
  language text not null check(language in ('en','fa')),
  state text not null default 'queued' check(state in ('queued','sending','sent','failed','unknown','cancelled')),
  attempts integer not null default 0,
  provider_id text,
  last_error text,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_outbox_queue_idx on support.email_outbox(state, created_at) where state in ('queued','sending');
create index support_outbox_user_idx on support.email_outbox(user_id, created_at desc);
create index support_outbox_draft_idx on support.email_outbox(draft_id);
create table support.template_revision (
  template_id text not null,
  revision integer not null,
  content jsonb not null,
  actor_id text not null,
  created_at timestamptz not null default now(),
  primary key(template_id,revision)
);
create table support.activity (
  id bigint generated always as identity primary key,
  actor_id text not null,
  action text not null,
  resource_id text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
alter table support.thread enable row level security;
alter table support.message enable row level security;
alter table support.reply_draft enable row level security;
alter table support.email_draft enable row level security;
alter table support.email_outbox enable row level security;
alter table support.template_revision enable row level security;
alter table support.activity enable row level security;
revoke all on all tables in schema support from public, anon, authenticated;
grant select,insert,update,delete on support.thread,support.message,support.reply_draft,support.email_draft,support.email_outbox to recalino_app;
grant select,insert on support.template_revision,support.activity to recalino_app;
grant usage,select on all sequences in schema support to recalino_app;
