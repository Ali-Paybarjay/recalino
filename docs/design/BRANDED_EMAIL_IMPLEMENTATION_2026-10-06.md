# Branded email delivery — 2026-10-06

The shared Recalino email shell is deployed to [the admin panel](https://recalino.vercel.app/admin). Sender and reply address remain `recalino.pilot@gmail.com`. No new service or domain was needed, and no new real email was sent during this work.

## Delivered behavior

- Nine routine templates, custom mail, and support notifications use the existing logo and mint/lime identity. English is LTR, Persian RTL. HTML is built with tables and inline styles, with Outlook conditional layout, system fonts, a mobile layout and a plaintext alternative.
- The owner can edit localized headline, preheader, and optional action. Every selected recipient has a complete desktop/mobile/plaintext preview before approval. The browser preview disables links and scripts.
- Subject/body/language, rendered HTML/text, CTA and versioned PNG are frozen on approval. Gmail emits multipart HTML/text and an inline CID image; Resend uses the same snapshot and inline asset contract. Legacy approvals remain plaintext.
- Feedback replies first save a private preview. Approval publishes that exact revision in the app and queues email only under the existing learner preference and owner approval rules. Changed recipient addresses require a new preview.
- Invalid stored presentation content is rejected before provider dispatch and recorded as a definite failure. Exceptions after dispatch retain the uncertain outcome/reconciliation rule.
- Additive migration `20261005234639_branded_email_snapshots.sql` applied locally and to Recalino project `twowhuzhvyuzjrpraikm`. Nullable snapshots have bounded JSON sizes; approved outbox recipient and content cannot be updated. Private-schema browser grants remain denied; physical privacy purge uses deletion and is preserved.

## Design and evidence

[Editable Figma email page](https://www.figma.com/design/8SZY9Ju3Fatad888Ba81Ra/Recalino?node-id=67-154) has welcome, feedback thanks and support reply in both languages and both widths: 12 frames, 5 reusable main components, 36 instances, 122 editable text nodes, and native vector logos. Email-specific variables follow current source colors without changing older Figma screens.

Synthetic HTML/text samples live in `artifacts/email-branding/`. Screenshots, visual checks and the Figma state ledger live in `artifacts/branded-email/`. The final 12 Chromium visual cases verify both directions and widths, loaded logo, bounded layout, no scripts, no live preview links and no remote asset requests.

Actual compiled Gmail MIME is tested, including the exact PNG bytes, CID, HTML/plaintext, language and escaped inputs. Four admin browser scenarios pass, including preview invalidation on editing, localized fields, mobile, feedback approval and unsafe markup. Two gateway integration scenarios verify unsafe URL rejection and changed recipient rejection. Frozen outbox/reply, legacy behavior and privacy projections are covered by integration tests.

Global lint, types, module boundaries and client-secret scan pass. Production build on Linux passes all native runtime checks and traces 104 function manifests with 10 native dependencies. Local Next compilation and page generation succeeded; its post-build native tracing encountered changing files from the already-running shared dev server, so the clean Vercel build provides the packaging verification.

Deployment `dpl_GyRv86JKzk9KnGUWKRc2LUvPkyNd`, unique URL `https://recalino-gszoiw4bu-ali-paybarjay-s-projects.vercel.app`, promoted to `https://recalino.vercel.app`. Production read-only smoke passes health, anonymous rejection, owner settings/templates/page, private cache policy, Gmail configuration and all nine localized template presentations. Metadata-only report: `artifacts/verification/branded-email-production-2026-10-06.json`.

Final unit run: 617 passed. The full integration run passed 315 tests and skipped one; its one failure was an old privacy fixture updating approved outbox content. The fixture now supplies those values during initial insertion. The final three related integration files pass all 24 tests, preserving the original privacy assertions. See [verification summary](../../artifacts/branded-email/verification-summary.json) for separate run evidence.

Actual Inbox display in Gmail, Outlook and Apple Mail was not tested. Only Chromium was installed locally; browser/MIME evidence is not a real-mail-client receipt test. A new test message requires approval of its exact recipient and content.
