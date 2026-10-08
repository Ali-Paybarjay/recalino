-- The declared group survives browser closure. Null preserves legacy explicit begin/complete.
alter table proc.automatic_session add column batch_manifest jsonb;
alter table proc.automatic_session add constraint automatic_batch_manifest_shape
  check (batch_manifest is null or
    (jsonb_typeof(batch_manifest) = 'array' and jsonb_array_length(batch_manifest) between 1 and 250));
create index automatic_session_open_manifest_idx on proc.automatic_session(updated_at, session_id)
  where batch_id is not null and batch_manifest is not null;
