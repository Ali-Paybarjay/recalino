# Frozen protocol: voice acceptance after one sample and one confirmed class

Protocol `voice-eval-ami-v1`, 2026-10-08. It is frozen **before any calibration or holdout
identity result is computed**: `freeze.json` records the SHA-256 of this file, the harness, the
production code it runs, the pipeline settings and every AMI file (`ami-manifest.json`).
`calibrate.ts` and `holdout.ts` refuse to run if any of them changed without a recorded
amendment (§8).

## 1. Question

After a learner (a) records one voice sample and (b) manually confirms their voice in one class,
can later classes be matched automatically by `decideVoiceMatch`
(`packages/core/src/voc/policy.ts`) without attributing someone else's speech to them? When the
evidence is weak, the policy must ask instead.

Out of scope: real Recalino classrooms (none are used, G11), languages other than the corpus,
pronunciation and the paid correction step. No AI provider or paid service is called.

## 2. Data

- **AMI Meeting Corpus**, CC BY 4.0 (`https://groups.inf.ed.ac.uk/ami/corpus/license.shtml`).
  In each scenario group, the same four participants (many of them non-native English speakers)
  hold four sessions (a–d) on different occasions. Later sessions are therefore independent
  later "classes" for the same people.
- Manual annotations `ami_public_manual_1.6.2.zip`
  (SHA-256 `b56e5babb2496b8795deeeda7e71178d7fbc9963f94276cf2a3f4b56ebbc9f9d`): speaker segments
  (`segments/*.segments.xml`) and `corpusResources/meetings.xml`. Ground-truth identity comes only
  from these human annotations, never from a model.
- All 33 scenario groups whose four sessions have segments for all four participants
  (`AMI_GROUPS` in `ami.ts`). IS1002 (no session a) and IS1005 (no session d) are excluded.
  Participants are disjoint across groups (checked against `meetings.xml`).
- Audio: `Mix-Headset.wav` (close-talking headsets, summed) for all sessions, and the far-field
  `Array1-01.wav` for sessions c and d. IS1007d has no `Array1-01`; its `Array2-02` is used.
- `ami-manifest.json` lists every file read, with its SHA-256, and each group's split.

## 3. Learner journey, per participant L of group G

1. **Voice sample (session a, headset).** L's annotated speech with every other participant's
   annotated speech, widened by 300 ms, cut out. Pieces of at least 3 s are taken longest first
   until 28 s (the last one is cut to fit), then put back in time order. They are joined with
   600 ms of silence after an 800 ms silent lead-in and no trailing silence, as after an automatic
   stop. Fewer than 16 s of such speech: `eval_insufficient_isolated_speech`. The audio is encoded
   like a browser recording (WebM/Opus, 32 kbit/s, mono, 48 kHz, `-application voip`) and passed
   to `prepareVoiceSample` (`apps/web/src/server/voice-sample.ts`), the enrolment route's own
   checks (15–35 s, one voice, at least 15 s of clean speech). A rejection is recorded and the
   participant has no sample.
2. **First class (session b, headset).** The recording runs through `diarizeVoiceRecording`
   (`apps/web/src/server/voice-processing.ts`) and `buildVoiceAnalysis`
   (`packages/core/src/proc/voice-processing.ts`), the production class check with the frozen
   pipeline settings (§4).
   - The **attentive learner** confirms the voice whose speech is mostly theirs (L's share of the
     annotated overlap greater than 0.5), preferring the largest share. No such voice:
     `no_candidate`.
   - The confirmation's effect is `voiceReferenceOutcome`: `short` (under 20 s clean speech),
     `mismatch` (less similar to the sample than `referenceConsistency`) or `added`.
   - The **mistaken learner** confirms the voice with the most clean speech that is mostly
     someone else. It is used for the poisoned-profile check (§7).
3. **Later classes.** Sessions c and d in three conditions: `headset`; `farfield`; `opus` (the
   headset mix re-encoded as WebM/Opus, 24 kbit/s, mono, 48 kHz, `-application voip`, like a phone
   browser recording). Each is a separate production check.
4. **Classes without the learner.** For every L, three meetings of other groups in the same
   split, chosen by position in the sorted split list: group +1 session c headset, group +2
   session d far-field, group +3 session c opus.

## 4. Pipeline settings (fixed before the freeze)

The settings below are the production defaults in `voice-engine.ts` and
`voice-source-windows.ts`. `freeze.json` records them and every feature file stores them; the
harness refuses features made with other settings.

| Setting | Value | Before this round |
|---|---|---|
| speaker-grouping (clustering) threshold | 0.5 | 0.5 |
| voiceprint spans | `clean-parts`: each turn minus every other voice's speech (±200 ms), pieces of at least 2 s | `whole-turns`: any overlap removed the whole turn |
| voice merge | pooled voiceprints at cosine ≥ 0.65 merged, never across ≥ 25% simultaneous speech | none |
| window plan | at most 8 windows of 58 s with 2 s gaps (478 s, within the 480 s ceiling) | 15 windows of 30 s |

How they were chosen (`tune-pipeline.ts`, all rows in `tuning-report.json`):

- Data: four **calibration** first-class meetings only (ES2002b, ES2005b, IS1000b, TS3008b;
  16 participants). No holdout audio was read, and no identity decision was simulated.
- Measures: participants with a pure voiceprint (the identity rule of §5.3), impure voiceprints,
  participants whose voice has a listening excerpt, voices and wall time.
- Rule: among configurations whose impure voiceprints are at most a quarter of their pure ones,
  the most participants with a pure voiceprint; ties go to fewer impure voiceprints, then more
  participants with an excerpt, then the configuration closest to the base. The rule was written
  after a first grid of the base rule only (kept in `tuning/old-overlap-rule/`) and before the
  grid it was applied to. That grid grew in steps (clean parts, then merge thresholds, then
  longer windows), and every configuration tried is in the report.
- Result: with the settings before this round (and this round's excerpt code), 2 of 16
  participants had a pure voiceprint, four people were split into up to 38 voices and no voice
  had a listening excerpt. The selected settings give 9 pure voiceprints,
  2 impure ones and excerpts for 11 participants, with 76 voices over the four meetings in place
  of 109.
- Known limit: in IS1000b the base clustering puts most of the meeting into one voice. Merging
  cannot split it, so impure voiceprints remain possible. The identity rule counts them, and the
  policy must survive them on the holdout.

## 5. Definitions

1. **References** of L: the sample vector and, if `added`, the confirmed class vector. The policy
   uses only these; automatic results never become references.
2. **Decision**: `decideVoiceMatch` with `rankVoiceCandidates` scores, exactly as
   `saveVoiceAnalysis` uses them. No account feedback is simulated (`rejectedScores` is empty);
   the production rejection guard can only make the policy ask more often.
3. **Identity of a detected voice** for participant L: the annotated speech of each participant
   inside the spans that formed its voiceprint (`embeddingSpans`), or inside all its turns if it
   has no voiceprint. It is **L** when L has at least 80% of the annotated overlap and annotated
   speech covers at least half of those spans; **L-majority** when L has more than 50% but the
   voice is not L; otherwise **other**. In classes without L, every voice is other.
4. **False attribution**: an automatic acceptance of a voice that is not L (L-majority, other, or
   any voice in a class without L). It is the critical failure.
5. **Opportunity**: a trial that reaches the score comparison (both references present and at
   least two voices with voiceprints). Its decision is accepted, `no_clear_match` or
   `similar_voices`.

## 6. Calibration (calibration split only)

Split (pre-registered): the first 24 groups listed alternate calibration, holdout within each
sorted site prefix (ES, IS, TS). The nine groups added when the list was found incomplete
(ES2004, ES2010, ES2014, IS1009, TS3003–TS3007) alternate holdout, calibration within each site.
This keeps the four tuning meetings in calibration. Result: 16 calibration groups
(64 participants) and 17 holdout groups (68 participants). `calibrate.ts` reads only calibration
features.

- `referenceConsistency` = the highest sample similarity of any first-class voice whose majority
  is someone else, over all calibration participants with a sample, **plus 0.05**.
- `acceptScore` = the highest agreement (`min(sample similarity, class-reference similarity)`) of
  any non-L voice with a voiceprint and at least `minCleanSpeechMs` of clean speech (only such a
  voice can be accepted) in any later or no-learner trial of a calibration participant whose
  reference was `added`, **plus 0.05**.
- `minMargin` = **0.10** (fixed). `minCleanSpeechMs` = **20 000** (the existing reference rule).
- The result is written to `calibration.json`, with in-sample figures that are not evidence.

## 7. Holdout evaluation and gates

`holdout.ts` applies `calibration.json` unchanged to the holdout split. It reports, per condition
and for classes without the learner:

- trials and extraction failures
- whether L has a voiceprint, and whether L's voice has a listening excerpt
- opportunities, correct acceptances, and false attributions by type
- the reasons for asking
- whether the production ranking puts L first

Excerpt counts use AMI manual segments in place of STT segments, plus the acoustic listening
excerpts; they are indicative, not a production rate. Resources: wall time, process CPU time and
peak resident memory of each production check, and the number of paid calls (zero).

Gates, fixed now:

| Gate | Condition | Role |
|---|---|---|
| SAFETY-1 | zero false attributions over all holdout trials; report count, opportunities and the two-sided 95% Clopper–Pearson upper bound | blocking |
| SAFETY-2 | zero false attributions when the mistaken first confirmation passed the sample check (poisoned profile) | blocking |
| EVIDENCE | at least 100 holdout opportunities | blocking |
| USEFULNESS | automatic acceptance in at least 50% of headset later classes where L has a voiceprint | reported, not blocking |

Automatic acceptance may be switched on in `VOICE_ACCEPTANCE_POLICIES` only if every blocking
gate passes. Zero observed errors in a finite sample is not a guarantee: the upper bound is
reported, and production activation remains the product owner's decision. If a blocking gate
fails, the policy stays off, the reference check may still be used, and the failure is reported.

## 8. Freeze rules

- `freeze.json` is written once by `freeze.ts --write` and committed before extraction results are
  read. `freeze.ts` without arguments re-checks every hash.
- Allowed after the freeze, recorded in `freeze.json` under `amendments` with the files and the
  reason: fixes to crashes or I/O that change no definition, constant, data selection, pipeline
  setting or gate.
- Not allowed in this round: changing the split, the enrolment or confirmation rules, the identity
  rule, the buffers, the margin, the gates, the pipeline settings or the policy function. A new
  attempt is a new protocol version with a new holdout.
