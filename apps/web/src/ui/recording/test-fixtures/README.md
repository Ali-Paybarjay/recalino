# Recorder fixtures

Synthetic tones only (no speech, no class audio), for `media-timeline.test.ts` and
`capture-honesty.test.ts`.

- `chromium-gap.webm`: Chromium MediaRecorder (`audio/webm;codecs=opus`, 12 kbps, 1 s timeslice)
  recording a Web Audio oscillator. After 2 s the `AudioContext` was suspended for 4 s, then
  resumed for 2 s. ffmpeg decodes 4020 ms of PCM; the device clock ran about 8 s. Chunk sizes in
  arrival order: 1603, 1588, 1588 and 1598 bytes, at about 1.07, 6.07, 7.09 and 8.07 s.
- `chromium-pause.webm`: Chromium's fake microphone, 2.5 s recorded, 1.5 s `pause()`, 2 s
  recorded. ffmpeg decodes 4500 ms.
- `fragmented.mp4`: `ffmpeg -f lavfi -i sine=f=440:d=3 -c:a aac -b:a 24k
  -movflags frag_keyframe+empty_moov+default_base_moof -frag_duration 1000000`, the fragmented
  layout Safari's recorder writes. ffmpeg decodes 3042 ms.
