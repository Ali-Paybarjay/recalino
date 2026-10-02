-- M3: ACC tables (FR-ACC-001 to FR-ACC-007). Owned by the ACC module (ADR-0002).
-- A Recalino account exists only for a Supabase Auth user who gave the sign-up declarations
-- (FR-ACC-001). Deleting the Auth user deletes the account and everything below it.

create schema acc;
revoke all on schema acc from public;
grant usage on schema acc to recalino_app;

-- FR-ACC-001, FR-ACC-006: one row per learner. No date of birth: only the time of the 18+
-- declaration (data minimisation).
create table acc.user_account (
  id uuid primary key references auth.users (id) on delete cascade,
  adult_declared_at timestamptz not null,
  timezone text,
  created_at timestamptz not null default now()
);

-- FR-ACC-001: the declarations given on the sign-in page, before Google. The callback consumes
-- the intent once, in the transaction that creates the account, so declarations can't be
-- forged or carried to another request. The id is random and lives in an httpOnly cookie.
create table acc.signup_intent (
  id text primary key check (char_length(id) between 32 and 128),
  adult_declared_at timestamptz not null,
  terms_version text not null,
  privacy_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid
);
create index signup_intent_expires_at_idx on acc.signup_intent (expires_at);

-- FR-ACC-001, FR-ACC-003, FR-ACC-007, D33: every acceptance with its version and time.
-- Append-only; the current acceptance is the newest row per document.
create table acc.consent (
  id bigint generated always as identity primary key,
  user_id uuid not null references acc.user_account (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'recording-consent')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

-- FR-ACC-003, FR-ACC-005: one active learning profile (PRD-ONB-02). Fields stay empty until
-- their setup step is answered; setup_step is the step to resume at.
create table acc.learning_profile (
  user_id uuid primary key references acc.user_account (id) on delete cascade,
  version integer not null default 1,
  first_language text,
  learning_language text not null default 'en' check (learning_language = 'en'),
  explanation_language text check (explanation_language in ('english', 'first_language')),
  level text check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'not_sure')),
  goal text check (goal in ('esol', 'ielts', 'general', 'none')),
  setup_step smallint not null default 1 check (setup_step between 1 and 8),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- FR-ACC-004: each change of the profile is a new version with its time. Processing records
-- the version it started with (PRD-LKM-02).
create table acc.learning_profile_history (
  user_id uuid not null references acc.user_account (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- FR-ACC-005: one store for teaching preferences. An explicit choice wins over an inferred one
-- (PERS writes inferred rows in stage 4).
create table acc.preference (
  user_id uuid not null references acc.user_account (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 64),
  origin text not null check (origin in ('explicit', 'inferred')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key, origin)
);

alter table acc.user_account enable row level security;
alter table acc.signup_intent enable row level security;
alter table acc.consent enable row level security;
alter table acc.learning_profile enable row level security;
alter table acc.learning_profile_history enable row level security;
alter table acc.preference enable row level security;

grant select, insert, update on acc.user_account to recalino_app;
grant select, insert, update, delete on acc.signup_intent to recalino_app;
grant select, insert on acc.consent to recalino_app;
grant select, insert, update on acc.learning_profile to recalino_app;
grant select, insert on acc.learning_profile_history to recalino_app;
grant select, insert, update, delete on acc.preference to recalino_app;
