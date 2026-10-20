# Automatic class learning

## User-authorized outcome

> Amended by D105 (owner decision 2026-10-20, `docs/PRODUCT_DECISIONS_LOG.md`): lesson work
> starts only when the learner presses "Process this session"; material added later waits for
> the next press. Publication and card generation stay automatic after that press.

Uploading documents, audio and photos creates and saves the class notebook and
flashcards automatically. Adding further material updates the same class. Normal
use requires no processing, notebook publication or card-generation button.

## Behavior

- Opening a file picker and uploading one batch records durable class intent
  before the first file. Processing waits until the batch closes and all chosen
  uploads have completed verification. Failed files are named and can be resumed.
- Finished recordings register all their parts first. A signed-in client uploads
  their durable local audio automatically through the existing checksummed,
  resumable upload protocol. Stop ends capture; no audio is uploaded mid-capture.
- The existing durable runner performs extraction and validated knowledge
  generation. Quota reservation, ownership, accepted source notice and uncertain
  provider outcome guards remain enforced. No retroactive generation of old
  classes is triggered by deployment.
- Automatic identity uses selected source checksums and ranges, independently of
  extraction cache IDs. Polling, metadata updates and reconnects do not reserve
  allowance or generate the same class repeatedly. Explicit retries have new keys.
- Valid output is published as editable notes and quality flashcards automatically.
  Worker retries after publication do not invoke the provider again. A newer
  request waits for any existing run; stale completions cannot mark it ready.
- Notebook history and learner edits remain available. Match existing goals
  conservatively; unmatched learner-edited content stays visible. Existing cards
  retain IDs, review history, status and learner edits; uncertain changes can be
  proposed for review. Rejected or deleted cards are not resurrected.
- Class, sources, notes and cards show concise current status and an Add material
  action. Errors explain the affected material and recovery; old outputs remain
  usable while updates run.

## Implementation boundaries

Processing owns automatic intent/batch state. Source routes notify that intent
after learner mutations and verified upload completion. App server orchestration
coordinates processing, notes and cards through their public APIs; the core
processing worker does not import notebook or card capabilities.

## Acceptance checks

1. Upload one mixed batch: one processing selection, saved notes and cards without
   clicking a generate/save button.
2. Upload another batch: new material appears, existing edits and reviewed-card
   identities survive, no duplicates or status resurrection.
3. Reload or disconnect during audio upload: checksummed parts resume and the
   same durable workflow finishes without another allowance reservation.
4. Upload during an active run: a subsequent snapshot includes the new material;
   no concurrent runs or stale ready status.
5. Failed upload, insufficient allowance and uncertain provider outcome explain
   recovery without repeatedly invoking the provider.
6. Cross-account requests cannot inspect or mutate automatic intent or outputs.
7. Unit/integration checks, actual browser story, types, boundaries and production
   build pass before the reviewed release is promoted to the online version.
