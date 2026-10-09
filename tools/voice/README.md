# Local acoustic speaker analysis

The engine runs **sherpa-onnx-node 1.13.8** on CPU. It uses pyannote segmentation 3.0 to find speech and simultaneous speakers, WeSpeaker ResNet34-LM to compute 256-dimensional acoustic speaker embeddings, and sherpa's agglomerative clustering to group turns. No text embedding or guessed role substitutes for voice identity. Each source has one native diarization invocation and one shared speaker namespace; speaker labels must not be equated across separately processed sources.

Class checks decode at most eight minutes of PCM, including two-second silence separators. Short selections are checked in full; longer selections use up to eight deterministic 58-second windows distributed across the selected recording ranges (`VOICE_WINDOW_PLAN`; fifteen 30-second windows before 2026-10-08, see the evaluation below). This keeps a two-hour-plus class within the native invocation budget without allocating its full waveform or silently abandoning acoustic matching. All windows are diarized together. Turns touching or crossing window boundaries are excluded before voiceprint pooling, and accepted turns are mapped back to their original recording timestamps. The full transcript and ordinary class notes remain intact; only checked speech can supply spoken mistakes. A persisted `sampled_audio` coverage marker is shown in class confirmation and survives correction saves or failures.

Each window is located by a container-time seek, exactly as the transcript chunks were cut, then read with one second of slack and cut by decoded samples. Container time and sample count never agree exactly for browser recordings: MediaRecorder stamps every 60 ms Opus packet with its capture clock, so packets in a real Chrome recording land 51–69 ms apart and a thirty-second seek decodes a few milliseconds more or less. Phone recorders show the same mismatch: the observed 2 h 8 min class (audio/mp4) declares 7,675,763 ms but decodes 7,675,883 ms because some AAC frames are written one tick short. Requiring an exact span therefore rejected real recordings outright (2026-10-08: that class failed its first window on every check, and a real ten-minute Chrome capture failed 3 of 15 windows). A window that cannot hold a turn (under 2.4 s, for example past a drifted container end) or that the demuxer refuses is skipped and disclosed through its own `partial_audio` marker, kept apart from planned sampling (`sampled_audio`; both together are `sampled_partial_audio`). Any decoder error looks like a refusal, so refusals are counted: when the decoder refuses more than half of the planned windows the recording is treated as damaged and the check fails (`voice_audio_windows_refused` in the log, stored as `voice_audio_unusable`). The check also fails when no window yields usable audio (`voice_audio_unusable`). Correction failures keep the coverage marker inside their reason (`voice_correction_<coverage>_<cause>`).

An expired class original without usable scoped speaker transcripts is rejected before another check/reservation is created. A saved personal voice sample does not replace the class recording. Native failures retain a safe diagnostic reason and show a failed check instead of asking for confirmation of nonexistent excerpts. Worker failures store `voice_inference_failed`; only the worker's fixed `voice_*` codes cross the thread boundary. Every failed check also writes one allow-listed `voice_check_failed` log line whose `code` names the failing step (for example `voice_audio_unusable`, `source_integrity_mismatch`, `voice_diarization_output_invalid` or `not_found`), and every completed native pass writes `voice_check_diarized` with its duration, its coverage code and integer window attrition (`windows_planned`, `windows_used`, `windows_refused`, `windows_short`, `audio_planned_ms`, `audio_used_ms`). Neither line contains audio, transcript text, paths or native messages. A sample ranks acoustic suggestions; first-class confirmation and the existing calibration requirements still apply.

## Provisioning

Run `node tools/voice/fetch-models.mjs` after installing dependencies. It downloads about 33 MB from the model maintainer's public release, verifies pinned SHA-256 hashes before using either model, and keeps the weights out of Git. It requires `tar` for the verified segmentation archive. Downloads happen only in this explicit provisioning command, never while processing user recordings.

The default paths are the verified `tools/voice/models/` directory beside the traced source worker. An operator-managed installation can override them with these **absolute server paths**, for example in `apps/web/.env.local`:

```dotenv
VOICE_SEGMENTATION_MODEL_PATH=/absolute/recalino/tools/voice/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx
VOICE_EMBEDDING_MODEL_PATH=/absolute/recalino/tools/voice/models/wespeaker_en_voxceleb_resnet34_LM.onnx
```

On Vercel (`VERCEL=1`), the normal application build explicitly provisions these pinned weights before compiling, runs real ONNX inference with synthetic PCM, then traces both weights and their attribution/license assets into the native functions. A missing model, checksum mismatch, unusable native library or failed inference fails the build. `RECALINO_PROVISION_VOICE_MODELS=1` enables the same mandatory provisioning outside Vercel. Local builds use existing weights when present; an installation without weights can still build with voice enrollment unavailable. Runtime requests never download models.

`next.config.ts` and the native tracers preserve the worker, JavaScript package, installed platform binary, shared libraries, weights and licenses. On Next 16/Vercel, `tools/native-build-adapter.mjs` wraps the original adapter supplied in `NEXT_ADAPTER_PATH`, delegates its configuration, then extends its asset snapshot **before** Vercel creates function packages. Post-build NFT edits happen too late for that adapter. Exact pnpm dependency links are included; globbing through symlink directories alone cannot preserve runtime module resolution. Local builds still extend their NFT manifests after compilation.

The adapter tests run separately from Vitest: `node --test apps/web/tools/native-build-adapter.test.mjs apps/web/tools/trace-native-dependencies.test.mjs`. They check that the packager receives all native assets, reject paths outside the repository, and relocate the resulting asset snapshot before running actual Canvas and voice embedding/diarization inference.

Windows x64 and Node 24 Linux x64 embedding/diarization smoke inference have passed; the Linux result is recorded in `linux-smoke-report.json`. The disposable Linux check mounts only the voice code and public models read-only, and records no person. Reproduce it with the image digest recorded in that report:

```sh
docker run --rm --mount type=bind,source=/absolute/recalino/tools/voice,target=/smoke/tools/voice,readonly --mount type=bind,source=/absolute/recalino/apps/web/src/server,target=/smoke/apps/web/src/server,readonly node:24-bookworm-slim sh /smoke/tools/voice/linux-smoke.sh
```

This Linux check verifies real model loading and inference; it does not measure classroom speaker-recognition accuracy. The staged Vercel runtime must also be checked before promotion because its packaged filesystem and Linux image differ from Docker. No Windows model path should be copied into production environment variables. Function duration and CPU limits can still prevent a long recording from finishing.

`loadVoiceEngine()` verifies weights before returning a `VoiceEngine`. `diarize(Float32Array, {sampleRate:16000, offsetMs:0, boundaries:[]})` accepts mono PCM and returns timestamps in milliseconds, local speaker IDs, overlap/boundary flags and normalized speaker vectors. `boundaries` marks composite window edges before any voiceprints are computed. `embed(Float32Array,16000)` accepts already checked clean enrollment speech. Matching uses cosine similarity. All CPU inference is isolated in a worker; concurrent invocations in one Node process are serialized and the worker is destroyed after each operation. The low-level engine retains a ten-minute timeout and two-hour PCM ceiling; the class caller now stays within an eight-minute composite. A timeout or failure still withholds verified speech evidence and reports its outcome.

## What the flags mean

The segmentation model has explicit two-speaker overlap states and sherpa returns intervals that may overlap. The wrapper marks any intersection of different speaker labels as overlap. A voiceprint uses only the clean parts of a voice's turns (`VOICE_SPAN_MODE = "clean-parts"`): every other voice's speech, widened by 200 ms, is cut out of the turn, and only pieces at least two seconds long are embedded. Before 2026-10-08 any overlap removed the whole turn, which in real meetings left almost no voiceprints. Edge-clipped and short turns are still excluded. At most 60 seconds spread through the recording contributes to each pooled vector. `cleanSpeechMs` is the amount actually embedded, not all detected speech.

Native clustering over-splits conversational audio: one person often becomes several voices. After pooling, voices whose pooled vectors reach cosine 0.65 are merged (`VOICE_MERGE_THRESHOLD`), most similar first. Two voices heard at the same time for at least a quarter of the shorter one's speech are never merged, because one person cannot talk over themselves. Merging cannot split a voice that the clustering already joined from several people.

These are conservative **model detections**, not guarantees that undetected overlap or speaker confusion is impossible. The native API supplies no calibrated identity confidence. A speaker can have transcript segments but no eligible vector; such a speaker must remain available for manual review, and may never be auto-accepted. The clustering threshold (0.5) and the merge threshold control speaker grouping only and are **not** identity acceptance thresholds. The app always asks on the first lesson. Automatic acceptance in later lessons needs an evaluated policy for the exact model revision in `packages/core/src/voc/policy-registry.ts`; without one, only the account's own calibration (20 confirmed and 20 rejected lessons) can accept.

## Reproducible real inference evaluation

The public [LibriSpeech test-clean corpus](https://www.openslr.org/12/) is CC-BY-4.0, copyright 2014 Vassil Panayotov. Download `https://www.openslr.org/resources/12/test-clean.tar.gz` into `tools/voice/evaluation-data/`, then extract it there. The archive is about 347 MB. The evaluation script uses three speakers (1089, 121, 237), reserves the first three utterances for enrollment and never uses those utterances in the simulated lessons. Its report records exact source filenames and machine information.

```sh
node --conditions=react-server tools/voice/evaluate.mjs
node --conditions=react-server tools/voice/evaluate.mjs --long-turns
node --conditions=react-server tools/voice/evaluate-overlap.mjs
```

The second run selects held-out utterances of at least eight seconds. Both scripts create three concatenated recordings where the enrolled learner has fewer turns than the teacher. Rankings and margins are measured with real ONNX inference. The checked-in reports retain failures as well as successes. These are clean read-speech simulations, **not real classrooms**, and do not justify production thresholds. Real classroom recordings evaluated: **zero**.

Observed on an i7-7700K with two inference threads: correct first candidate in **2/3 short-turn recordings** and **3/3 longer-turn recordings**. The missed learner in the short-turn set had no eligible clean vector. Correct longer-turn similarities were 0.928, 0.820 and 0.820, with margins 0.448, 0.066 and 0.203; a wrong candidate reached 0.754. Runtime was approximately 0.20–0.46 times recording duration, with other development tasks running. These results support requiring manual confirmation, not choosing an automatic acceptance threshold.

The separate overlap stress test mixes two held-out speakers for eight seconds. The model detected 5.839 seconds of simultaneous speech (73% interval recall); the wrapper withheld entire touched turns. **Undetected overlap remains possible.** The report records this limitation rather than assigning confidence 1 to single-label intervals.

## Frozen AMI evaluation (2026-10-08)

The acceptance policy for later classes is evaluated on the AMI Meeting Corpus (CC BY 4.0): real multi-party meetings, many with non-native English speakers, where the same four people meet in four sessions. The protocol, split, gates and freeze rules are in [`evaluation/PROTOCOL.md`](evaluation/PROTOCOL.md). The audio, features and extraction logs are kept out of Git in `tools/voice/evaluation-data/`.

```sh
pnpm exec tsx tools/voice/evaluation/download.ts                                   # about 12 GB
pnpm exec tsx --conditions=react-server tools/voice/evaluation/freeze.ts            # check the freeze
pnpm exec tsx --conditions=react-server tools/voice/evaluation/extract.ts --split calibration
pnpm exec tsx --conditions=react-server tools/voice/evaluation/extract.ts --split holdout
pnpm exec tsx --conditions=react-server tools/voice/evaluation/calibrate.ts
pnpm exec tsx --conditions=react-server tools/voice/evaluation/holdout.ts
pnpm exec tsx --conditions=react-server tools/voice/evaluation/supplement.ts   # post-hoc, not a gate
pnpm exec biome format --write tools/voice/evaluation/*.json
```

Extraction runs every production check on CPU, so it takes hours; it skips meetings whose features already exist. `calibrate.ts` and `holdout.ts` refuse to run when a frozen file or the pipeline settings changed. No AI provider or paid service is called.

## Model provenance and licenses

`models.manifest.json` records all URLs, hashes, revisions and attributions. The GitHub WeSpeaker artifact includes sherpa metadata and therefore differs from the upstream Hugging Face ONNX checksum; the pinned hash is for the exact artifact used by this engine.

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): Apache-2.0, next-gen Kaldi team. [Native API example](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/nodejs-addon-examples/test_offline_speaker_diarization.js).
- [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0): MIT, copyright 2022 CNRS. The downloaded archive contains the full MIT license, which must accompany any redistribution.
- [WeSpeaker wespeaker-voxceleb-resnet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM): [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), WeSpeaker team; trained on VoxCeleb2. ONNX metadata conversion by k2-fsa/sherpa-onnx. Recalino has not altered the weights. Retain this attribution and license link with deployed model distributions.
- The pyannoteAI Reverb model was deliberately not selected because its released weights have a noncommercial license.
