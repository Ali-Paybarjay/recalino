# Local acoustic speaker analysis

The engine runs **sherpa-onnx-node 1.13.8** on CPU. It uses pyannote segmentation 3.0 to find speech and simultaneous speakers, WeSpeaker ResNet34-LM to compute 256-dimensional acoustic speaker embeddings, and sherpa's agglomerative clustering to group turns. No text embedding or guessed role substitutes for voice identity. One complete source is diarized in one invocation; speaker labels must not be equated across separately processed sources.

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

`loadVoiceEngine()` verifies weights before returning a `VoiceEngine`. `diarize(Float32Array, {sampleRate:16000, offsetMs:0})` accepts mono PCM and returns timestamps in milliseconds, local speaker IDs, overlap/boundary flags and normalized speaker vectors. `embed(Float32Array,16000)` accepts already checked clean enrollment speech. Matching uses cosine similarity. All CPU inference is isolated in a worker; concurrent invocations in one Node process are serialized and the worker is destroyed after each operation. There is a ten-minute timeout and a two-hour input ceiling. Long recordings may hit the timeout; a caller must continue without verified speech evidence when analysis fails.

## What the flags mean

The segmentation model has explicit two-speaker overlap states and sherpa returns intervals that may overlap. The wrapper marks any intersection of different speaker labels as overlap and excludes both entire intervals from the voiceprint pool. It also excludes edge-clipped and short turns, trims 200 ms from each accepted turn boundary, and embeds only spans at least two seconds long. At most 60 seconds spread through the recording contributes to each pooled vector. `cleanSpeechMs` is the amount actually embedded, not all detected speech.

These are conservative **model detections**, not guarantees that undetected overlap or speaker confusion is impossible. The native API supplies no calibrated identity confidence. A speaker can have transcript segments but no eligible vector; such a speaker must remain available for manual review, and may never be auto-accepted. The clustering threshold (0.5) controls speaker grouping only and is **not** an identity acceptance threshold. The app must ask on the first lesson and keep automatic identity acceptance disabled until it has enough real confirmed/rejected examples to calibrate both score and margin.

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

## Model provenance and licenses

`models.manifest.json` records all URLs, hashes, revisions and attributions. The GitHub WeSpeaker artifact includes sherpa metadata and therefore differs from the upstream Hugging Face ONNX checksum; the pinned hash is for the exact artifact used by this engine.

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): Apache-2.0, next-gen Kaldi team. [Native API example](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/nodejs-addon-examples/test_offline_speaker_diarization.js).
- [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0): MIT, copyright 2022 CNRS. The downloaded archive contains the full MIT license, which must accompany any redistribution.
- [WeSpeaker wespeaker-voxceleb-resnet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM): [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), WeSpeaker team; trained on VoxCeleb2. ONNX metadata conversion by k2-fsa/sherpa-onnx. Recalino has not altered the weights. Retain this attribution and license link with deployed model distributions.
- The pyannoteAI Reverb model was deliberately not selected because its released weights have a noncommercial license.
