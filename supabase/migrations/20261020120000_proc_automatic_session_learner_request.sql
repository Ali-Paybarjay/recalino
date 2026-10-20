-- D105 (owner decision 2026-10-20): a session is processed only after the learner presses
-- "Process this session". requested_version is the request_version the learner asked to process;
-- any later material change raises request_version above it, so the session is open again and
-- waits for another press. Additive only: no data is deleted. Intents that exist today count as
-- already requested, so sessions in production keep working; new material follows the new rule.
alter table proc.automatic_session
  add column requested_version integer check (requested_version > 0),
  add column requested_at timestamptz;
update proc.automatic_session
  set requested_version = request_version, requested_at = updated_at
  where requested_version is null;
alter table proc.automatic_session
  add constraint automatic_session_requested_pair
    check ((requested_version is null) = (requested_at is null)),
  add constraint automatic_session_requested_le_request
    check (requested_version <= request_version);
-- Lesson work is pending only for the material the learner asked to process. An open declared
-- upload batch stays listed without a request, so its verification recovery keeps running.
drop index proc.automatic_session_pending_idx;
create index automatic_session_pending_idx on proc.automatic_session(updated_at, session_id)
  where (requested_version = request_version
      and (state in ('waiting_sources','waiting_upload','processing')
        or (state='blocked'
          and last_error in ('configuration_unavailable','storage_unavailable','settings_changed'))))
    or (batch_id is not null and batch_manifest is not null);
