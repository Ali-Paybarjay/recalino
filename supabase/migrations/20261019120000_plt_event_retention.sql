-- SEC-07 (audit 2026-10-18, D95): security events are kept for 90 days and the audit trail loses
-- the id of a deleted account. The work happens at run time: the daily jobs
-- plt.purge_security_events and priv.anonymise_deleted_actors, and account cleanup when a deletion
-- completes. This migration only grants what those need and changes no rows.
grant delete on plt.security_event to recalino_app;

-- Audit rows stay append-only: the application may change actor_id and no other column, and only
-- to the marker written for a deleted account (DELETED_ACCOUNT_ACTOR in packages/core/src/plt).
grant update (actor_id) on plt.audit_event to recalino_app;

create function plt.keep_audit_event_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.actor_id <> 'deleted_account'
     or row(new.occurred_at, new.actor_kind, new.action, new.subject_type, new.subject_id,
            new.reason, new.request_id)
        is distinct from row(old.occurred_at, old.actor_kind, old.action, old.subject_type,
            old.subject_id, old.reason, old.request_id) then
    raise exception 'audit events only lose a deleted account id' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function plt.keep_audit_event_history() from public, anon, authenticated;
create trigger audit_event_history_immutable before update on plt.audit_event
for each row execute function plt.keep_audit_event_history();

-- Account cleanup and the daily job look audit rows up by actor.
create index audit_event_actor_id_idx on plt.audit_event (actor_id);
