# Recording segments and class synchronization

## Objective and approved scope

The learner approved independent 5–10 minute recordings, one class, durable local
capture and automatic resumable uploads after Stop and processing confirmation.
Use ten minutes by default, counting recorded time only. Preserve explicit
Pause/Stop, interruption recovery, account ownership and account-deletion guards.

## Modules and order

| Module | Responsibility | Depends on |
| --- | --- | --- |
| capture | Independent ten-minute containers without storage-induced capture gaps | local recording store |
| source-sync | Automatically register completed parts under the same class | capture, existing source API |
| audio-upload | Upload all selected parts after processing confirmation, resume verified parts | source-sync, existing processing API |
| media-session | Best-effort supported browser recording controls | capture |

## Implementation

- Start the next recorder on the same live microphone stream immediately when the
  old recorder is stopped at a boundary. Persist each run's events under its own ID.
- Persist a shared capture ID, ordered part number, segment-local duration and photo
  offsets. Display a cumulative recording timer.
- Mark the capture completed only after the learner selects Stop. Automatically
  register completed, durable, nonempty parts; never register a changing container.
- Keep local audio and retry interrupted metadata requests with stable idempotency
  keys. Store source association atomically without resetting chunk counters.
- Register parts in capture order, including after failed acknowledgments or late
  final audio. Earlier pending parts block later parts of the same class while
  independent class queues continue.
- Scope decoder chunk IDs by run and source, so independently recorded files never
  share a transcription checkpoint. Preserve existing cached chunk manifests.
- Preserve the existing processing estimate/confirmation. Actual audio upload uses
  the existing authenticated, checksummed multipart upload and verification flow.
- Block processing while local parts of that class are still active, awaiting final
  audio or waiting for source registration. Refresh the estimate before confirmation
  so newly registered parts cannot be silently omitted from a confirmed run.
- Platform notifications must control a genuine capture service; do not create
  playback notifications by playing silent audio.

## Verification

- Unit tests: regular boundaries, paused time, Stop at a boundary, delayed final
  chunks, storage/microphone failures, atomic registration, offline recovery,
  stable class IDs and account-deletion cancellation.
- Decoder regression: two real independently decoded files, distinct transcription
  checkpoint keys, and stable IDs on retry.
- Real Chromium: native MediaRecorder, independent decoding of all parts, real
  IndexedDB, actual UI controls, metadata request retries and confirmed multipart
  audio uploads through a local API fixture.
- Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint` and
  `pnpm check:boundaries`. Preserve unrelated concurrent workspace changes.
- Browser verification uses accelerated segment timing with native audio encoders
  and actual IndexedDB. API/storage/worker responses are localhost fixtures; this
  verifies the production client but does not invoke the live worker/AI provider.

## Platform decision

The current product is Next.js/PWA. Browser Media Session does not grant microphone
background lifetime or guarantee capture-only lock-screen controls. Dependable
Android recording while locked requires a microphone foreground service and
native segment storage, with notification Pause/Resume/Stop actions. Android SDK,
Java and a physical device are not currently available in this workspace.
The learner chose web/PWA only and accepted the lock-screen limitation. Add genuine
Media Session recording state and supported actions without playing artificial audio.
Native Android delivery is outside this approved stage.

References: [Media Session routing](https://www.w3.org/TR/mediasession/#routing),
[Android microphone foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone).
