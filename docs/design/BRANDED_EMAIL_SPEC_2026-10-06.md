# Branded customer email — 2026-10-06

Status: implementation authorized by the product owner in this conversation.

Use the existing Recalino identity and temporary Gmail sender. No new domain, paid service, logo redesign, or font dependency is required. The visual system uses mint `#eef9f3`, white `#fbfffd`, dark green `#13261f`, primary green `#0d7556`, and lime `#b9f06b`, with the existing application icon.

## Deliverables

- A shared, responsive HTML shell for all nine routine templates, custom emails, and approved feedback notifications. Three representative examples (welcome, feedback thanks, support reply) in English and Persian, desktop and mobile, are editable in the existing Figma file.
- Localized heading, inbox preheader, and optional primary action, alongside the existing subject/body editor. Persian uses RTL; English uses LTR. A visible URL fallback and plaintext alternative remain usable when images or styling are unavailable.
- Admin previews the complete rendered message at desktop/mobile widths. Approval freezes each recipient's subject, language, body, HTML, plaintext, action, and asset/design versions. Sending consumes that snapshot. A changed draft requires a new preview and approval.
- Feedback replies first save an owner-only preview; the second step approves that exact draft and publishes the in-app reply, with an email notification only when requested by the learner and approved by the owner.
- Gmail MIME includes the trusted PNG logo inline using CID. No tracking pixels, remote images, arbitrary HTML editor, or user-supplied attachment path. Untrusted text is escaped; action URLs must be valid HTTPS URLs.
- Additive nullable snapshot columns. Existing approved plaintext emails keep their original content and transport behavior.

## Acceptance

1. Rendered EN/FA welcome, thanks, and support examples are readable at 390px and 600px, with no horizontal overflow.
2. HTML injection/unsafe URL cases fail safely; previews execute no scripts and load no remote assets.
3. Real compiled Gmail MIME contains HTML, plaintext, and the exact versioned logo. Legacy rows remain plaintext. Unsupported snapshot versions fail before dispatch.
4. Integration tests show draft edits cannot change an approved outbox snapshot and reply approval uses the saved preview.
5. Admin owner access, notification preference, deletion guards, queue receipts, TLS, and uncertain-send retry restrictions are preserved.
6. Local and production migrations, types, browser flows, server checks, build, and production read-only smoke checks pass.

Actual Inbox rendering in Gmail, Outlook, and Apple Mail requires access to those mailboxes. Browser engines and MIME checks are useful evidence but are not represented as real mail-client receipt tests. No new test message is sent without approval of its exact recipient and content.
