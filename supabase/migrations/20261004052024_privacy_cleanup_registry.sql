alter table priv.deletion_request add column modules text[] not null default '{}';
alter table priv.deletion_request add column related_sessions uuid[] not null default '{}';
alter table priv.deletion_request drop constraint deletion_request_kind_check;
alter table priv.deletion_request add constraint deletion_request_kind_check check(kind in ('session','account','source'));
