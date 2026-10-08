-- Owner-approved branded mail: no backfill, so all previous approvals retain their plain-text appearance.
alter table support.email_outbox add column presentation jsonb;
alter table support.email_outbox add constraint email_outbox_presentation_size
  check (presentation is null or (jsonb_typeof(presentation) = 'object' and octet_length(presentation::text) <= 524288));
alter table support.reply_draft add column email_preview jsonb;
alter table support.reply_draft add constraint reply_draft_email_preview_size
  check (email_preview is null or (jsonb_typeof(email_preview) = 'object' and octet_length(email_preview::text) <= 524288));

-- Outbox content is the approval receipt. Delivery state can change; approved text, visual content and recipient cannot.
create function support.keep_email_approval_snapshot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.email, new.subject, new.body, new.language, new.presentation)
     is distinct from row(old.email, old.subject, old.body, old.language, old.presentation) then
    raise exception 'approved email content is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function support.keep_email_approval_snapshot() from public, anon, authenticated;
create trigger email_outbox_approval_immutable before update on support.email_outbox
for each row execute function support.keep_email_approval_snapshot();

comment on column support.email_outbox.presentation is 'Immutable supported-version HTML/text/logo snapshot; null denotes a legacy plain-text approval.';
comment on column support.reply_draft.email_preview is 'Exact email preview frozen for a reply revision and copied to the outbox only after owner approval.';
