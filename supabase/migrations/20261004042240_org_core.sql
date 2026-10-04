-- ORG: courses, optional units and class sessions (FR-ORG-001..008).
-- Every table is private; the application role performs ownership checks.
create schema org;
revoke all on schema org from public;
grant usage on schema org to recalino_app;

create table org.course (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references acc.user_account (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160 and name = btrim(name)),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index course_owner_name_idx on org.course (owner_id, lower(name));
create unique index course_one_default_idx on org.course (owner_id) where is_default;

create table org.unit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references acc.user_account (id) on delete cascade,
  course_id uuid not null,
  name text not null check (char_length(name) between 1 and 160 and name = btrim(name)),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references org.course (id, owner_id) on delete cascade,
  unique (id, course_id, owner_id)
);
create unique index unit_course_name_idx on org.unit (course_id, lower(name));
create index unit_course_position_idx on org.unit (course_id, position, id);

create table org.class_session (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references acc.user_account (id) on delete cascade,
  -- Tombstones may be detached when their empty course is deleted; live sessions cannot.
  course_id uuid,
  unit_id uuid,
  title text check (char_length(title) between 1 and 200 and title = btrim(title)),
  class_date date not null,
  sources_version integer not null default 0 check (sources_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deletion_request_id uuid unique,
  foreign key (course_id, owner_id) references org.course (id, owner_id),
  foreign key (unit_id, course_id, owner_id) references org.unit (id, course_id, owner_id),
  check (deleted_at is not null or course_id is not null),
  check ((deleted_at is null) = (deletion_request_id is null)),
  unique (id, owner_id)
);
create index session_owner_date_idx on org.class_session (owner_id, class_date desc, id desc)
  where deleted_at is null;
create index session_course_date_idx on org.class_session (course_id, class_date desc, id desc)
  where deleted_at is null;

-- FR-ORG-007: durable deletion receipt; PRIV coordinates physical cleanup later.
create table org.deletion_request (
  id uuid primary key,
  owner_id uuid not null references acc.user_account (id) on delete cascade,
  session_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (session_id, owner_id) references org.class_session (id, owner_id) on delete cascade
);

-- Cancellation/cleanup signal commits with the tombstone. Payload contains identifiers only.
create table org.outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references acc.user_account (id) on delete cascade,
  session_id uuid not null references org.class_session (id) on delete cascade,
  event_type text not null check (event_type = 'session_deleted'),
  deletion_request_id uuid not null references org.deletion_request (id) on delete cascade,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (event_type, session_id)
);
create index outbox_unprocessed_idx on org.outbox (created_at, id) where processed_at is null;

alter table org.course enable row level security;
alter table org.unit enable row level security;
alter table org.class_session enable row level security;
alter table org.deletion_request enable row level security;
alter table org.outbox enable row level security;

grant select, insert, update, delete on org.course, org.unit to recalino_app;
grant select, insert, update on org.class_session, org.deletion_request, org.outbox to recalino_app;
