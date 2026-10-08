-- Owner-authorized Part 6, 2026-10-06. Optional voice identity, server-only access.
create schema if not exists voc;
revoke all on schema voc from public, anon, authenticated;
grant usage on schema voc to recalino_app;

create table voc.profile (
  user_id uuid primary key references acc.user_account(id) on delete cascade,
  version integer not null default 1 check(version > 0),
  enabled boolean not null default false,
  consent_version text,
  consented_at timestamptz,
  sample_object_id uuid references plt.storage_object(id) on delete set null,
  sample_duration_ms integer check(sample_duration_ms between 15000 and 35000),
  model_version text,
  embeddings jsonb not null default '[]' check(jsonb_typeof(embeddings)='array'),
  updated_at timestamptz not null default now(),
  check(not enabled or (consent_version is not null and consented_at is not null))
);
create index voice_profile_sample_idx on voc.profile(sample_object_id) where sample_object_id is not null;
-- Cleanup pointers survive revocation and failed/late object writes.
create table voc.sample_object (
  object_id uuid primary key references plt.storage_object(id) on delete cascade,
  user_id uuid not null references acc.user_account(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index voice_sample_owner_idx on voc.sample_object(user_id);
create table voc.analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  session_id uuid not null,
  source_id uuid not null references src.asset(id) on delete cascade,
  source_version_id uuid not null references src.content_version(id) on delete cascade,
  run_id uuid not null,
  profile_version integer not null check(profile_version > 0),
  model_version text not null,
  version integer not null default 1 check(version > 0),
  status text not null check(status in ('processing','unverified','verified','none','unavailable','failed')),
  candidate_id text,
  verified_speaker_id text,
  verification_method text check(verification_method in ('manual','automatic')),
  reason text,
  candidates jsonb not null default '[]' check(jsonb_typeof(candidates)='array'),
  utterances jsonb not null default '[]' check(jsonb_typeof(utterances)='array'),
  mistakes jsonb not null default '{}' check(jsonb_typeof(mistakes)='object'),
  private_embeddings jsonb not null default '[]' check(jsonb_typeof(private_embeddings)='array'),
  embeddings_expire_at timestamptz not null,
  rejected_ids jsonb not null default '[]' check(jsonb_typeof(rejected_ids)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(session_id,user_id) references org.class_session(id,owner_id) on delete cascade,
  unique(session_id,source_id,source_version_id,run_id),
  check((status='verified') = (verified_speaker_id is not null and verification_method is not null))
);
create index voice_analysis_owner_session_idx on voc.analysis(user_id,session_id,created_at desc);
create index voice_analysis_source_idx on voc.analysis(source_id);
create index voice_analysis_source_version_idx on voc.analysis(source_version_id);
create index voice_analysis_expiry_idx on voc.analysis(embeddings_expire_at)
  where private_embeddings <> '[]'::jsonb;
create table voc.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  analysis_id uuid not null references voc.analysis(id) on delete cascade,
  model_version text not null,
  speaker_id text not null,
  score double precision check(score between -1 and 1),
  margin double precision check(margin between 0 and 2),
  accepted boolean not null,
  created_at timestamptz not null default now(),
  unique(analysis_id,speaker_id)
);
create index voice_feedback_owner_idx on voc.feedback(user_id,model_version);
create index voice_feedback_analysis_idx on voc.feedback(analysis_id);
alter table voc.profile enable row level security;
alter table voc.sample_object enable row level security;
alter table voc.analysis enable row level security;
alter table voc.feedback enable row level security;
revoke all on all tables in schema voc from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema voc to recalino_app;
