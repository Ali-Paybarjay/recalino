-- anki.export_artifact was created with `like html.export_artifact including all`, which already
-- copies the owner and cleanup indexes under generated names; the explicit anki_export_* indexes
-- that follow duplicate them (Supabase advisor: duplicate_index). Keep the explicitly named pair,
-- matching html.export_artifact, and drop the copies. No data changes.
drop index if exists anki.export_artifact_user_id_session_id_created_at_idx;
drop index if exists anki.export_artifact_expires_at_idx;
