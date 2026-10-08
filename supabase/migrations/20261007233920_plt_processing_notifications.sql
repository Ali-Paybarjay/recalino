-- Durable learner inbox and opt-in Web Push. No class content is stored in a push payload.
create table plt.notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  deduplication_key text not null check (char_length(deduplication_key) between 1 and 200),
  kind text not null check (kind in ('processing_ready', 'processing_partial', 'processing_failed')),
  href text not null check (href ~ '^/classes/[0-9a-f-]{36}/(notes|processing)$'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, deduplication_key)
);
create index notification_inbox_idx on plt.notification(user_id, created_at desc);

create table plt.push_subscription (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 4096),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth text not null check (char_length(auth) between 20 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscription_owner_idx on plt.push_subscription(user_id);

-- Snapshot recipients when the notification commits. A later opt-in never sends old alerts.
create table plt.push_delivery (
  notification_id uuid not null references plt.notification(id) on delete cascade,
  subscription_id uuid not null references plt.push_subscription(id) on delete cascade,
  delivered_at timestamptz,
  primary key (notification_id, subscription_id)
);
create index push_delivery_subscription_idx on plt.push_delivery(subscription_id);

alter table plt.notification enable row level security;
alter table plt.push_subscription enable row level security;
alter table plt.push_delivery enable row level security;
-- Browser roles have no access; the trusted app explicitly checks the learner on every call.
grant select, insert, update, delete on plt.notification, plt.push_subscription, plt.push_delivery to recalino_app;

-- A transactional marker makes cron recovery bounded and survives a missed completion hook.
alter table proc.processing_run add column notification_recorded_at timestamptz;
create index processing_run_notification_due_idx on proc.processing_run(updated_at)
  where kind = 'class' and notification_recorded_at is null
    and state in ('ready', 'partial_ready', 'failed', 'needs_input');
