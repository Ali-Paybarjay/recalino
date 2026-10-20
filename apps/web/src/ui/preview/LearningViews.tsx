"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Actions, Button, Field, Panel, Status } from "../workspace/primitives";
import styles from "./LearningViews.module.css";
import { type PreviewState, type SampleCard, usePreview } from "./PreviewContext";
import { LinkButton, PageHeader } from "./preview-links";

type Rating = PreviewState["reviewEvents"][number]["rating"];
const TYPES: Record<SampleCard["type"], string> = {
  qa: "Question and answer",
  vocabulary: "Vocabulary",
  cloze: "Cloze · fill the gap",
  grammar: "Grammar point",
  error: "Error correction",
  listening: "Listening",
};
const FORMAT_HINTS: Record<SampleCard["type"], string> = {
  qa: "Remember one clear answer.",
  vocabulary: "Remember the meaning in this class context.",
  cloze: "Complete the missing part before you reveal the answer.",
  grammar: "Remember the pattern and how to use it.",
  error: "Find the error and say the corrected sentence.",
  listening: "Listen first, then compare with the written example.",
};
const FORMAT_EXAMPLES: Record<SampleCard["type"], { question: string; answer: string }> = {
  qa: { question: "What is the present perfect form?", answer: "have / has + past participle" },
  vocabulary: {
    question: "What does already mean in this example?",
    answer: "Something happened earlier than expected.",
  },
  cloze: { question: "She ___ finished her homework.", answer: "has" },
  grammar: {
    question: "How do we form the present perfect?",
    answer: "have / has + past participle. Example: She has finished.",
  },
  error: { question: "Correct this sentence: She have finished.", answer: "She has finished." },
  listening: {
    question: "Listen and complete the sentence.",
    answer: "I have already finished my homework.",
  },
};

function CardInstruction({ type }: { type: SampleCard["type"] }) {
  return <p className={styles.muted}>{FORMAT_HINTS[type]}</p>;
}
const PROPOSAL = [
  "Use already when something happened earlier than expected. It usually comes between have / has and the past participle.",
  "My example: I have already finished my homework, so I can relax now.",
];

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function withNoteVersion(state: PreviewState, text: string, label: string, id: string) {
  return {
    ...state,
    noteText: text,
    noteHistory: [...state.noteHistory, { id, text, label }],
  };
}

function SourceLabel({ source, classId }: { source: string; classId?: string }) {
  const { setState } = usePreview();
  const ai = /ai|computer voice/i.test(source);
  const prepared = /prepared|authored|not extracted/i.test(source);
  return (
    <div className={styles.provenance}>
      <span
        className={
          prepared
            ? "workspace-chip"
            : ai
              ? "workspace-provenance-ai"
              : "workspace-provenance-class"
        }
      >
        {prepared ? "Prepared sample" : ai ? "AI explanation · sample" : "From class · sample"}
      </span>
      <Link
        className={styles.sourceLink}
        href="/preview/source"
        onClick={
          classId
            ? () =>
                setState((previous) => {
                  const lesson = previous.classes.find((item) => item.id === classId);
                  return lesson
                    ? {
                        ...previous,
                        classes: [
                          lesson,
                          ...previous.classes.filter((item) => item.id !== classId),
                        ],
                      }
                    : previous;
                })
            : undefined
        }
      >
        {source}
      </Link>
    </div>
  );
}

function ComputerVoice({ text }: { text: string }) {
  const { announce } = usePreview();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function play() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      announce("This browser cannot play a computer voice. Read the written example instead.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.85;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      announce("The computer voice could not play. The written example is available.");
    };
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }
  return (
    <div className="workspace-stack">
      <p className={styles.muted}>
        Computer voice demonstration. This is not your session recording.
      </p>
      <Actions>
        <Button secondary onClick={play} disabled={speaking}>
          Hear computer voice
        </Button>
        {speaking ? (
          <Button
            secondary
            onClick={() => {
              window.speechSynthesis.cancel();
              setSpeaking(false);
            }}
          >
            Stop voice
          </Button>
        ) : null}
      </Actions>
    </div>
  );
}

function Notes() {
  const { state } = usePreview();
  const [answer, setAnswer] = useState(false);
  const edited = state.noteHistory.length > 1;
  const authored = state.noteHistory.some((version) => /Authored/i.test(version.label));
  return (
    <div className={styles.layout}>
      <PageHeader
        title={state.classes[0]?.title ?? "Present perfect"}
        description={`Session notes · sample material · Version ${state.noteHistory.length}`}
        back="class"
      />
      {state.processing === "partial" ? (
        <Status>
          The sample job is partly ready.{" "}
          {state.processingSnapshot
            .filter((source) => source.status === "Needs retry")
            .map((source) => source.name)
            .join(", ")}{" "}
          needs another try. These authored examples are not extracted from your files.
        </Status>
      ) : null}
      <div className={styles.readerLayout}>
        <div className={`${styles.reading} workspace-stack`}>
          <Panel title="In this class" tone="hero">
            <p>Talk about things that happened before now and still matter now.</p>
            <p className={styles.muted}>
              Your own examples help you connect English to daily life.
            </p>
          </Panel>
          <section id="useful-words" className={styles.section}>
            <h2>Already and yet</h2>
            <SourceLabel source={authored ? "Prepared sample reference" : "Audio 18:42"} />
            <blockquote className={styles.quote}>“I’ve already finished my homework.”</blockquote>
            <span className={edited ? "workspace-chip" : "workspace-provenance-class"}>
              {edited
                ? "Edited by you · sample version"
                : authored
                  ? "Authored sample · not extracted from files"
                  : "From class · sample"}
            </span>
            <p className={styles.edited}>{state.noteText}</p>
            <p>
              <span className="workspace-provenance-ai">AI explanation · sample</span>
            </p>
            <p>
              Already often comes before the main verb: “I have <strong>already finished</strong>.”
            </p>
          </section>
          <section id="grammar" className={styles.section}>
            <h2>Present perfect</h2>
            <SourceLabel source={authored ? "Prepared sample handout" : "Handout · page 2"} />
            <p className={styles.formula}>have / has + past participle</p>
            <p>
              I have visited London.
              <br />
              She has not finished yet.
            </p>
          </section>
          <section id="practice" className={styles.section}>
            <Panel title="Try it">
              <p>I have _____ finished my homework.</p>
              <Button secondary aria-expanded={answer} onClick={() => setAnswer(!answer)}>
                {answer ? "Hide answer" : "Show answer"}
              </Button>
              {answer ? (
                <p>
                  <strong>already</strong> — sooner than expected.
                </p>
              ) : null}
            </Panel>
          </section>
        </div>
        <aside className={styles.sidebar} aria-label="Notes navigation and tools">
          <Panel title="In these notes">
            <nav className={styles.outline} aria-label="Sections">
              <a href="#useful-words">Useful words</a>
              <a href="#grammar">Grammar</a>
              <a href="#practice">Practice</a>
            </nav>
          </Panel>
          <Panel title="Keep learning">
            <div className="workspace-stack">
              <LinkButton to="cards">Suggested cards</LinkButton>
              <LinkButton to="edit-notes" secondary>
                Edit notes
              </LinkButton>
              <LinkButton to="history" secondary>
                Compare versions
              </LinkButton>
              <LinkButton to="transcript" secondary>
                Transcript
              </LinkButton>
              <LinkButton to="export" secondary>
                Export notes
              </LinkButton>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Source() {
  const { announce } = usePreview();
  const [tab, setTab] = useState("handout");
  const [audio, setAudio] = useState<{ url: string; name: string } | null>(null);
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );
  return (
    <div className={styles.layout}>
      <PageHeader
        title="From your class"
        description="The source behind this part of the notes."
        back="notes"
      />
      <fieldset className={styles.tabs} aria-label="Source to view">
        {(
          [
            ["handout", "Handout · page 2"],
            ["audio", "Class audio"],
            ["board", "Board note"],
          ] as const
        ).map(([id, title]) => (
          <Button key={id} secondary aria-pressed={tab === id} onClick={() => setTab(id)}>
            {title}
          </Button>
        ))}
      </fieldset>
      {tab === "handout" ? (
        <Panel title="Handout · page 2">
          <p className={styles.muted}>
            Synthetic sample page, shown as readable text. This is not an uploaded PDF.
          </p>
          <article className={styles.sheet} aria-label="Sample present perfect handout, page 2">
            <span className="workspace-provenance-class">Sample class material</span>
            <h3>Present perfect</h3>
            <p>Use it for a past action connected to now.</p>
            <div className={styles.formula}>have / has + past participle</div>
            <p>
              <strong>Already:</strong> I have already finished my homework.
            </p>
            <p>
              <strong>Yet:</strong> She has not finished yet.
            </p>
            <p className={styles.muted}>Page 2 of the sample handout</p>
          </article>
        </Panel>
      ) : tab === "board" ? (
        <Panel title="Board note · source time 18:42">
          <p className={styles.muted}>
            A text illustration of the sample board. No real photo is shown.
          </p>
          <div className={styles.board}>
            have / has + past participle
            <br />
            <strong>already</strong> / yet
          </div>
        </Panel>
      ) : (
        <Panel title="Class audio · 18:42–18:55">
          {audio ? (
            <>
              <p>
                Local file: <bdi>{audio.name}</bdi>
              </p>
              <p className={styles.muted}>
                This plays the file you chose. The preview cannot verify that it matches the
                reference. Nothing is uploaded.
              </p>
              <audio controls src={audio.url} aria-label="Your chosen local audio file">
                <track
                  kind="captions"
                  src="data:text/vtt,WEBVTT"
                  label="No captions available for chosen file"
                  default
                />
              </audio>
            </>
          ) : (
            <Status>
              This sample has no original class audio. Original recordings can only play when the
              file is on this device.
            </Status>
          )}
          <blockquote className={styles.quote}>“I’ve already finished my homework.”</blockquote>
          <Field
            label="Choose a local audio file"
            hint="The file stays in your browser for this view only."
          >
            <input
              className={styles.field}
              type="file"
              accept="audio/*"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                if (
                  !file.type.startsWith("audio/") &&
                  !/\.(wav|mp3|m4a|ogg|webm|aac|flac)$/i.test(file.name)
                ) {
                  announce("Choose an audio file to play locally.");
                  return;
                }
                setAudio({ url: URL.createObjectURL(file), name: file.name });
                announce("Local audio selected. It has not been uploaded.");
              }}
            />
          </Field>
        </Panel>
      )}
      <LinkButton to="notes" secondary>
        Back to notes
      </LinkButton>
    </div>
  );
}

function EditNotes() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const [text, setText] = useState(state.noteText);
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Edit this section"
        description="Your changes create a new version of the notes."
        back="notes"
      />
      <form
        className="workspace-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          if (text !== state.noteText) {
            const id = makeId("notes");
            setState((previous) => withNoteVersion(previous, text.trim(), "Edited by you", id));
            announce("A new sample note version was saved. Earlier versions are still available.");
          } else announce("No changes to save. Your current version is kept.");
          router.push("/preview/notes");
        }}
      >
        <Panel title="Already and yet">
          <Field label="Your explanation" hint="Class references stay attached to this section.">
            <textarea
              className={`${styles.field} ${styles.textarea}`}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        </Panel>
        <Panel title="Keep the source">
          <SourceLabel source="Audio 18:42" />
          <p>Your edit will be labelled “Edited by you”. Previous versions stay available.</p>
        </Panel>
        <Actions>
          <Button type="submit" disabled={!text.trim()}>
            Save a new version
          </Button>
          <LinkButton to="notes" secondary>
            Cancel
          </LinkButton>
        </Actions>
      </form>
    </div>
  );
}

function History() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const [proposal, setProposal] = useState(false);
  const [include, setInclude] = useState([true, false]);
  function apply() {
    const selected = PROPOSAL.filter((_, index) => include[index]);
    if (!selected.length) return;
    const text = [include[0] ? PROPOSAL[0] : state.noteText, include[1] ? PROPOSAL[1] : ""]
      .filter(Boolean)
      .join("\n\n");
    const id = makeId("notes");
    setState((previous) =>
      withNoteVersion(previous, text, "Sample suggestion accepted by you", id),
    );
    announce("Selected sample changes saved as a new version. Earlier edits are kept in history.");
    router.push("/preview/card-update");
  }
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Compare note versions"
        description="Keep your edits or accept a suggested section."
        back="notes"
      />
      <Panel title="Version history">
        <ol className={styles.history}>
          {[...state.noteHistory].reverse().map((version, index) => (
            <li key={version.id}>
              <strong>
                Version {state.noteHistory.length - index} · {version.label}
              </strong>
              {index === 0 ? <span className="workspace-chip">Current</span> : null}
              <details>
                <summary className={styles.sourceLink}>Read this version</summary>
                <p className={styles.edited}>{version.text}</p>
              </details>
              {index !== 0 ? (
                <Button
                  secondary
                  onClick={() => {
                    const id = makeId("notes");
                    setState((previous) =>
                      withNoteVersion(
                        previous,
                        version.text,
                        `Restored version ${state.noteHistory.length - index}`,
                        id,
                      ),
                    );
                    announce(
                      "A previous version was restored as a new version. Nothing was overwritten.",
                    );
                  }}
                >
                  Restore as a new version
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        <Button secondary onClick={() => setProposal(true)}>
          Show a sample regeneration proposal
        </Button>
        <p className={styles.muted}>
          A prepared demonstration; no AI request or processing allowance is used.
        </p>
      </Panel>
      {proposal ? (
        <>
          <div className={styles.comparison}>
            <Panel title="Your current section">
              <p className={styles.edited}>{state.noteText}</p>
              <span className="workspace-chip">Kept until you accept changes</span>
            </Panel>
            <Panel title="Suggested section">
              <fieldset className={styles.choices}>
                <legend>Choose which sample changes to apply</legend>
                {PROPOSAL.map((text, index) => (
                  <label key={text} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={include[index]}
                      onChange={(event) =>
                        setInclude((current) =>
                          current.map((checked, i) =>
                            i === index ? event.target.checked : checked,
                          ),
                        )
                      }
                    />
                    {text}
                  </label>
                ))}
              </fieldset>
            </Panel>
          </div>
          <Actions>
            <Button disabled={!include.some(Boolean)} onClick={apply}>
              Apply selected changes
            </Button>
            <LinkButton to="notes" secondary>
              Keep current notes
            </LinkButton>
          </Actions>
        </>
      ) : null}
    </div>
  );
}

function Transcript() {
  const { state, setState, announce } = usePreview();
  const [text, setText] = useState(state.transcript);
  const [speaker, setSpeaker] = useState(
    state.transcript.match(/^(Teacher|Learner|Speaker 1|Unknown speaker):/)?.[1] ?? "Speaker 1",
  );
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Session transcript"
        description="Read or correct what was said in the sample class."
        back="class"
      />
      <Panel title="18:42 · sample audio">
        <SourceLabel source="Audio 18:42" />
        <form
          className="workspace-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const nextText = text.replace(
              /^(Teacher|Learner|Speaker 1|Unknown speaker):/,
              `${speaker}:`,
            );
            setState((previous) => ({ ...previous, transcript: nextText }));
            setText(nextText);
            announce("Sample transcript corrections saved. Existing note versions are unchanged.");
          }}
        >
          <Field
            label="First speaker role"
            hint="Choose Teacher only when you can identify the speaker."
          >
            <select
              className={styles.field}
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
            >
              <option>Speaker 1</option>
              <option>Teacher</option>
              <option>Learner</option>
              <option>Unknown speaker</option>
            </select>
          </Field>
          <Field
            label="Transcript text"
            hint="Correct words and speaker labels. This is sample text, not an automatic transcription."
          >
            <textarea
              className={`${styles.field} ${styles.textarea}`}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!text.trim()}>
            Save corrections
          </Button>
        </form>
      </Panel>
      <Panel title="Make corrections part of your notes">
        <p>
          Compare a suggested update before applying it. Your older notes will remain available.
        </p>
        <LinkButton to="history" secondary>
          Compare sample note update
        </LinkButton>
      </Panel>
    </div>
  );
}

type ExportOptions = {
  examples: boolean;
  explanation: boolean;
  practice: boolean;
  sources: boolean;
};
export function escapeSampleHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

export function buildSampleHtml(
  title: string,
  text: string,
  version: number,
  options: ExportOptions,
) {
  const safe = escapeSampleHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)} — sample notes</title><style>body{max-width:740px;margin:40px auto;padding:0 24px;color:#1c3028;background:#fff;font:17px/1.7 system-ui,sans-serif}h1,h2{line-height:1.3}.note{white-space:pre-wrap;overflow-wrap:anywhere}.label{font-size:14px;color:#58685f}blockquote{border-left:4px solid #28634a;padding-left:20px}section{margin:28px 0}@media print{body{margin:0}}</style></head><body><p class="label">Recalino sample workspace · Version ${version} snapshot</p><h1>${safe(title)}</h1><section><h2>Your notes</h2><p class="note">${safe(text)}</p></section>${options.examples ? "<section><h2>Class example · sample</h2><blockquote>“I have already finished my homework.”</blockquote></section>" : ""}${options.explanation ? "<section><h2>AI explanation · prepared sample</h2><p>Already often comes before the main verb.</p></section>" : ""}${options.practice ? "<section><h2>Practice</h2><p>I have _____ finished my homework.</p><details><summary>Show answer</summary><p>already — sooner than expected.</p></details></section>" : ""}${options.sources ? "<section><h2>Source references · sample</h2><ul><li>Class audio, 18:42. Original audio is not included.</li><li>Handout, page 2. Original PDF is not included.</li></ul></section>" : ""}<footer class="label">A standalone sample HTML copy. No audio, transcript, names, review history or external resources are included.</footer></body></html>`;
}

function ExportNotes() {
  const { state, announce } = usePreview();
  const [options, setOptions] = useState<ExportOptions>({
    examples: true,
    explanation: true,
    practice: true,
    sources: true,
  });
  const title = state.classes[0]?.title ?? "Present perfect";
  const html = buildSampleHtml(title, state.noteText, state.noteHistory.length, options);
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Take your learning with you"
        description="Choose what to include before you export."
        back="notes"
      />
      <div className="workspace-grid">
        <Panel title="HTML notes">
          <p>
            A readable, standalone copy of Version {state.noteHistory.length}. Your notes are always
            included.
          </p>
          <fieldset className={styles.choices}>
            <legend>Include in your download</legend>
            {(
              [
                ["examples", "Class examples"],
                ["explanation", "AI explanations · sample"],
                ["practice", "Practice and answers"],
                ["sources", "Source references"],
              ] as const
            ).map(([key, label]) => (
              <label className={styles.check} key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) =>
                    setOptions((previous) => ({ ...previous, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className={styles.muted}>
            About {Math.max(1, Math.ceil(new Blob([html]).size / 1024))} KB. No original files,
            transcript, names or review history. Images are not included in this sample export.
          </p>
          <Button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([html], { type: "text/html;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "recalino-sample-notes.html";
              document.body.append(link);
              link.click();
              link.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              announce("Sample HTML download started. It contains the note version you selected.");
            }}
          >
            Download sample HTML
          </Button>
        </Panel>
        <Panel title="Anki cards">
          <p>
            {
              state.cards.filter(
                (card) => card.classId === state.classes[0]?.id && card.status === "active",
              ).length
            }{" "}
            active sample cards in this session.
          </p>
          <Status>
            Anki export is not connected in this preview. No Anki package can be downloaded yet.
          </Status>
          <p className={styles.muted}>
            A future export will include selected card content and permitted media, without review
            history or Anki synchronization.
          </p>
          <LinkButton to="cards" secondary>
            Manage your cards
          </LinkButton>
        </Panel>
      </div>
      <LinkButton to="notes" secondary>
        Back to notes
      </LinkButton>
    </div>
  );
}

function normalized(card: SampleCard) {
  return `${card.question.trim().toLowerCase()}|${card.answer.trim().toLowerCase()}`;
}

function Cards() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const [tab, setTab] = useState<"suggested" | "saved">("suggested");
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<SampleCard[]>([]);
  const classCards = state.cards.filter((card) => card.classId === state.classes[0]?.id);
  const visible = classCards.filter((card) =>
    tab === "suggested"
      ? card.status === "suggested"
      : ["active", "known", "suspended"].includes(card.status),
  );
  const selection = selected.filter((id) => visible.some((card) => card.id === id));
  function change(ids: string[], patch: Partial<SampleCard>, message: string) {
    setUndo(state.cards.filter((card) => ids.includes(card.id)));
    setState((previous) => ({
      ...previous,
      cards: previous.cards.map((card) => (ids.includes(card.id) ? { ...card, ...patch } : card)),
    }));
    setSelected([]);
    announce(message);
  }
  function edit(card: SampleCard) {
    setState((previous) => ({ ...previous, selectedCardId: card.id }));
    router.push("/preview/card-editor");
  }
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Choose useful cards"
        description="Select the ideas you want to practise from this session."
        back="notes"
      />
      <div className={styles.toolbar}>
        <fieldset className={styles.tabs} aria-label="Card list">
          <Button
            secondary
            aria-pressed={tab === "suggested"}
            onClick={() => {
              setTab("suggested");
              setSelected([]);
            }}
          >
            Suggestions ({classCards.filter((card) => card.status === "suggested").length})
          </Button>
          <Button
            secondary
            aria-pressed={tab === "saved"}
            onClick={() => {
              setTab("saved");
              setSelected([]);
            }}
          >
            My cards (
            {
              classCards.filter((card) => ["active", "known", "suspended"].includes(card.status))
                .length
            }
            )
          </Button>
        </fieldset>
        <LinkButton to="card-types" secondary>
          Preview card types
        </LinkButton>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={visible.length > 0 && selection.length === visible.length}
            disabled={!visible.length}
            onChange={(event) =>
              setSelected(event.target.checked ? visible.map((card) => card.id) : [])
            }
          />
          Select all · {selection.length} selected
        </label>
        <Actions>
          {tab === "suggested" ? (
            <>
              <Button
                disabled={!selection.length}
                onClick={() =>
                  change(
                    selection,
                    { status: "active" },
                    "Selected sample cards added to your review queue.",
                  )
                }
              >
                Add selected
              </Button>
              <Button
                secondary
                disabled={!selection.length}
                onClick={() =>
                  change(
                    selection,
                    { status: "rejected" },
                    "Selected suggestions rejected. This is not a memory rating.",
                  )
                }
              >
                Reject selected
              </Button>
            </>
          ) : (
            <Button
              secondary
              disabled={!selection.length}
              onClick={() =>
                change(
                  selection,
                  { status: "suspended" },
                  "Selected sample cards suspended. Review history is kept.",
                )
              }
            >
              Suspend selected
            </Button>
          )}
        </Actions>
      </div>
      {undo.length ? (
        <div className={styles.toolbar}>
          <p>Last card change can be undone.</p>
          <Button
            secondary
            onClick={() => {
              const originals = new Map(undo.map((card) => [card.id, card]));
              setState((previous) => ({
                ...previous,
                cards: previous.cards.map((card) => originals.get(card.id) ?? card),
              }));
              setUndo([]);
              announce("Last sample card change undone.");
            }}
          >
            Undo last change
          </Button>
        </div>
      ) : null}
      {visible.length ? (
        <div className={styles.cards}>
          {visible.map((card) => {
            const duplicate = classCards.find(
              (other) =>
                other.id !== card.id &&
                other.status !== "deleted" &&
                other.status !== "rejected" &&
                normalized(other) === normalized(card),
            );
            return (
              <article key={card.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className="workspace-chip">{TYPES[card.type]}</span>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={selection.includes(card.id)}
                      aria-label={`Select ${card.question}`}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, card.id]
                            : previous.filter((id) => id !== card.id),
                        )
                      }
                    />
                    Select
                  </label>
                </div>
                <CardInstruction type={card.type} />
                <h2>{card.question}</h2>
                <p>{card.answer}</p>
                <SourceLabel source={card.source} classId={card.classId} />
                {card.status !== "suggested" ? (
                  <p className={styles.muted}>
                    {card.status === "active"
                      ? "In your sample review queue"
                      : card.status === "known"
                        ? "Known · chosen by you"
                        : "Suspended · history kept"}
                  </p>
                ) : null}
                {duplicate ? (
                  <Status>
                    An identical sample card already exists. You can merge it or keep a separate
                    card.
                  </Status>
                ) : null}
                <div className={styles.cardActions}>
                  {card.status === "suggested" ? (
                    <>
                      <Button
                        onClick={() =>
                          change([card.id], { status: "active" }, "Sample card added to review.")
                        }
                      >
                        {duplicate ? "Add separately" : "Add card"}
                      </Button>
                      <Button
                        secondary
                        onClick={() =>
                          change(
                            [card.id],
                            { status: "rejected" },
                            "Suggestion rejected; no memory rating recorded.",
                          )
                        }
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  <Button secondary onClick={() => edit(card)}>
                    Edit
                  </Button>
                  <Button
                    secondary
                    onClick={() => {
                      const copy = { ...card, id: makeId("card"), status: "suggested" as const };
                      setState((previous) => ({ ...previous, cards: [...previous.cards, copy] }));
                      setTab("suggested");
                      announce(
                        "A separate copy was added to sample suggestions. No AI request was made.",
                      );
                    }}
                  >
                    Copy card
                  </Button>
                  {duplicate ? (
                    <Button
                      secondary
                      onClick={() => {
                        setUndo([card, duplicate]);
                        const keep = card.status === "suggested" ? duplicate : card;
                        const remove = keep.id === card.id ? duplicate : card;
                        setState((previous) => ({
                          ...previous,
                          cards: previous.cards.map((item) =>
                            item.id === remove.id
                              ? { ...item, status: "deleted" }
                              : item.id === keep.id
                                ? {
                                    ...item,
                                    status: "active",
                                    important: item.important || card.important,
                                    tooHard: item.tooHard || card.tooHard,
                                  }
                                : item,
                          ),
                        }));
                        announce(
                          "Identical sample cards merged. The existing card and its review history are kept.",
                        );
                      }}
                    >
                      Merge identical cards
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel title={tab === "suggested" ? "Suggestions are all checked" : "No saved cards yet"}>
          <p>
            {tab === "suggested"
              ? "You can view your saved cards or bring back rejected suggestions."
              : "Add a useful suggestion to start practising."}
          </p>
          <Button
            secondary
            onClick={() => {
              const rejected = classCards
                .filter((card) => card.status === "rejected")
                .map((card) => card.id);
              if (rejected.length)
                change(rejected, { status: "suggested" }, "Rejected sample suggestions restored.");
              setTab("suggested");
            }}
          >
            View or restore suggestions
          </Button>
        </Panel>
      )}
      <Actions>
        <LinkButton to="review">Open review</LinkButton>
        <LinkButton to="notes" secondary>
          Back to notes
        </LinkButton>
      </Actions>
    </div>
  );
}

function CardTypes() {
  const { state } = usePreview();
  const [shown, setShown] = useState<string[]>([]);
  const examples = (Object.keys(TYPES) as SampleCard["type"][]).map(
    (type) =>
      state.cards.find(
        (card) =>
          card.classId === state.classes[0]?.id && card.type === type && card.status !== "deleted",
      ) ??
      ({
        id: type,
        classId: state.classes[0]?.id ?? "sample-gallery",
        type,
        question: FORMAT_EXAMPLES[type].question,
        answer: FORMAT_EXAMPLES[type].answer,
        source: "Prepared sample",
        status: "suggested",
        important: false,
        tooHard: false,
      } as SampleCard),
  );
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Six ways to practise"
        description="The card type should suit what you want to remember."
        back="cards"
      />
      <div className={styles.cards}>
        {examples.map((card) => (
          <article className={styles.card} key={card.type}>
            <span className="workspace-chip">{TYPES[card.type]}</span>
            <CardInstruction type={card.type} />
            <h2>{card.question}</h2>
            {card.type === "listening" ? <ComputerVoice text={card.answer} /> : null}
            <Button
              secondary
              aria-expanded={shown.includes(card.type)}
              onClick={() =>
                setShown((previous) =>
                  previous.includes(card.type)
                    ? previous.filter((type) => type !== card.type)
                    : [...previous, card.type],
                )
              }
            >
              {shown.includes(card.type)
                ? "Hide answer"
                : card.type === "listening"
                  ? "Show written example"
                  : "Show answer"}
            </Button>
            {shown.includes(card.type) ? (
              <p className={card.type === "grammar" ? styles.formula : undefined}>{card.answer}</p>
            ) : null}
          </article>
        ))}
      </div>
      <LinkButton to="cards" secondary>
        Back to suggestions
      </LinkButton>
    </div>
  );
}

function CardEditor() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const card =
    state.cards.find(
      (item) => item.id === state.selectedCardId && item.classId === state.classes[0]?.id,
    ) ??
    state.cards.find((item) => item.classId === state.classes[0]?.id && item.status !== "deleted");
  const [type, setType] = useState<SampleCard["type"]>(card?.type ?? "qa");
  const [question, setQuestion] = useState(card?.question ?? "");
  const [answer, setAnswer] = useState(card?.answer ?? "");
  const [objectiveChanged, setObjectiveChanged] = useState(false);
  const [historyChoice, setHistoryChoice] = useState<"keep" | "new" | "">("");
  const [deleting, setDeleting] = useState(false);
  const [undo, setUndo] = useState<SampleCard | null>(null);
  if (!card)
    return (
      <div className={styles.layout}>
        <PageHeader title="No card to edit" back="cards" />
        <Panel>
          <p>Choose a card from your suggestions first.</p>
          <LinkButton to="cards">Open cards</LinkButton>
        </Panel>
      </div>
    );
  if (card.status === "deleted")
    return (
      <div className={styles.layout}>
        <PageHeader title="Sample card removed" back="cards" />
        <Panel>
          <p>The card is out of your sample queue. Existing review history is kept.</p>
          {undo ? (
            <Button
              secondary
              onClick={() => {
                setState((previous) => ({
                  ...previous,
                  cards: previous.cards.map((item) => (item.id === undo.id ? undo : item)),
                  selectedCardId: undo.id,
                }));
                setUndo(null);
                announce("Sample card removal undone.");
              }}
            >
              Undo removal
            </Button>
          ) : null}
          <LinkButton to="cards" secondary>
            Back to cards
          </LinkButton>
        </Panel>
      </div>
    );
  function patch(changes: Partial<SampleCard>, message: string) {
    if (!card) return;
    setUndo(card);
    setState((previous) => ({
      ...previous,
      selectedCardId: card.id,
      cards: previous.cards.map((item) => (item.id === card.id ? { ...item, ...changes } : item)),
    }));
    announce(message);
  }
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Make this card useful"
        description="Keep one clear learning goal on each card."
        back="cards"
      />
      <form
        className="workspace-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim() || !answer.trim() || (objectiveChanged && !historyChoice)) return;
          const changes = { type, question: question.trim(), answer: answer.trim() };
          if (objectiveChanged && historyChoice === "new") {
            const newCard: SampleCard = {
              ...card,
              ...changes,
              id: makeId("card"),
              status: "active",
            };
            setState((previous) => ({
              ...previous,
              selectedCardId: newCard.id,
              cards: [
                ...previous.cards.map((item) =>
                  item.id === card.id ? { ...item, status: "suspended" as const } : item,
                ),
                newCard,
              ],
            }));
            announce(
              "A new sample card was created. The old card is suspended and keeps its review history.",
            );
          } else {
            patch(changes, "Sample card saved. Its existing review history is kept.");
          }
          router.push("/preview/cards");
        }}
      >
        <Panel title="Card content">
          <div className="workspace-stack">
            <Field label="Card type" hint={FORMAT_HINTS[type]}>
              <select
                className={styles.field}
                value={type}
                onChange={(event) => setType(event.target.value as SampleCard["type"])}
              >
                {Object.entries(TYPES).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Question">
              <textarea
                className={styles.field}
                rows={3}
                required
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </Field>
            <Field label="Answer">
              <textarea
                className={styles.field}
                rows={3}
                required
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>
            <SourceLabel source={card.source} classId={card.classId} />
          </div>
        </Panel>
        <Panel title="Learning goal">
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={objectiveChanged}
              onChange={(event) => {
                setObjectiveChanged(event.target.checked);
                setHistoryChoice("");
              }}
            />
            This edit changes what I want to learn.
          </label>
          {objectiveChanged ? (
            <fieldset className={styles.choices}>
              <legend>Choose what to do with review history</legend>
              <label className={styles.check}>
                <input
                  required
                  type="radio"
                  name="card-history"
                  value="keep"
                  checked={historyChoice === "keep"}
                  onChange={() => setHistoryChoice("keep")}
                />
                Keep this card and its history
              </label>
              <label className={styles.check}>
                <input
                  required
                  type="radio"
                  name="card-history"
                  value="new"
                  checked={historyChoice === "new"}
                  onChange={() => setHistoryChoice("new")}
                />
                Create a new card; suspend the old card and keep its history
              </label>
            </fieldset>
          ) : (
            <p className={styles.muted}>
              Small wording corrections can keep the same card and review history.
            </p>
          )}
        </Panel>
        <Actions>
          <Button
            type="submit"
            disabled={!question.trim() || !answer.trim() || (objectiveChanged && !historyChoice)}
          >
            Save card
          </Button>
          <LinkButton to="cards" secondary>
            Cancel
          </LinkButton>
        </Actions>
      </form>
      <Panel title="Card actions">
        <p className={styles.muted}>
          These choices manage your cards. They do not rate your memory.
        </p>
        <div className={styles.choices}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={card.important}
              onChange={(event) =>
                patch({ important: event.target.checked }, "Sample card importance updated.")
              }
            />
            Important to me
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={card.tooHard}
              onChange={(event) =>
                patch(
                  { tooHard: event.target.checked },
                  "Difficulty preference updated; no review rating was recorded.",
                )
              }
            />
            Too hard · I would prefer a simpler card
          </label>
        </div>
        <Actions>
          <Button
            secondary
            onClick={() =>
              patch(
                { status: card.status === "known" ? "active" : "known" },
                card.status === "known"
                  ? "Sample card returned to review."
                  : "Marked known by you. No test result is implied.",
              )
            }
          >
            {card.status === "known" ? "Return known card to review" : "I know this"}
          </Button>
          <Button
            secondary
            onClick={() =>
              patch(
                { status: card.status === "suspended" ? "active" : "suspended" },
                "Sample card review status updated. History is kept.",
              )
            }
          >
            {card.status === "suspended" ? "Resume card" : "Suspend card"}
          </Button>
          <Button
            secondary
            onClick={() =>
              patch(
                { status: "suspended" },
                "Wrong sample card suspended. No report was sent to a service.",
              )
            }
          >
            Wrong card · suspend
          </Button>
          <Button secondary onClick={() => setDeleting(true)}>
            Remove card
          </Button>
        </Actions>
        {deleting ? (
          <div className="workspace-stack">
            <Status>
              Remove this sample card from your queue? Its sample review history remains. You can
              undo this removal here.
            </Status>
            <Actions>
              <Button secondary autoFocus onClick={() => setDeleting(false)}>
                Keep card
              </Button>
              <Button
                secondary
                onClick={() => {
                  patch({ status: "deleted" }, "Sample card removed. You can undo this action.");
                  setDeleting(false);
                }}
              >
                Confirm removal
              </Button>
            </Actions>
          </div>
        ) : null}
        {undo ? (
          <Button
            secondary
            onClick={() => {
              setState((previous) => ({
                ...previous,
                cards: previous.cards.map((item) => (item.id === undo.id ? undo : item)),
                selectedCardId: undo.id,
              }));
              setUndo(null);
              announce("Last sample card change undone.");
            }}
          >
            Undo last card change
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}

function CardUpdate() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const card =
    state.cards.find(
      (item) =>
        item.classId === state.classes[0]?.id &&
        item.id === state.selectedCardId &&
        item.type === "vocabulary" &&
        item.status !== "deleted",
    ) ??
    state.cards.find(
      (item) =>
        item.classId === state.classes[0]?.id &&
        item.type === "vocabulary" &&
        item.status !== "deleted",
    );
  const [history, setHistory] = useState<"keep" | "new">("keep");
  const answer =
    "Something happened earlier than expected. Already comes before the main verb in this sample example.";
  if (!card)
    return (
      <div className={styles.layout}>
        <PageHeader title="No card update to compare" back="cards" />
        <LinkButton to="cards">Open cards</LinkButton>
      </div>
    );
  return (
    <div className={styles.layout}>
      <PageHeader
        title="A card update is ready"
        description="Prepared sample proposal. Decide whether to update this card."
        back="notes"
      />
      <div className={styles.comparison}>
        <Panel title="Your current card">
          <h3>{card.question}</h3>
          <p>{card.answer}</p>
          <SourceLabel source={card.source} classId={card.classId} />
        </Panel>
        <Panel title="Suggested update">
          <h3>{card.question}</h3>
          <p>{answer}</p>
          <span className="workspace-provenance-ai">Sample suggestion · not applied</span>
        </Panel>
      </div>
      <Panel title="Review history">
        <fieldset className={styles.choices}>
          <legend>If the learning goal changes, choose a new card</legend>
          <label className={styles.check}>
            <input
              type="radio"
              name="update-history"
              checked={history === "keep"}
              onChange={() => setHistory("keep")}
            />
            Keep this card and its history
          </label>
          <label className={styles.check}>
            <input
              type="radio"
              name="update-history"
              checked={history === "new"}
              onChange={() => setHistory("new")}
            />
            Create a new card; suspend the old one
          </label>
        </fieldset>
      </Panel>
      <Actions>
        <Button
          onClick={() => {
            if (history === "new") {
              const next = { ...card, id: makeId("card"), answer, status: "active" as const };
              setState((previous) => ({
                ...previous,
                selectedCardId: next.id,
                cards: [
                  ...previous.cards.map((item) =>
                    item.id === card.id ? { ...item, status: "suspended" as const } : item,
                  ),
                  next,
                ],
              }));
            } else
              setState((previous) => ({
                ...previous,
                selectedCardId: card.id,
                cards: previous.cards.map((item) =>
                  item.id === card.id ? { ...item, answer } : item,
                ),
              }));
            announce("Sample card update accepted. Existing history has been preserved.");
            router.push("/preview/cards");
          }}
        >
          Accept update
        </Button>
        <Button
          secondary
          onClick={() => {
            announce("Your current card is kept. The sample proposal was not applied.");
            router.push("/preview/cards");
          }}
        >
          Keep current card
        </Button>
      </Actions>
    </div>
  );
}

function isSampleNewCard(state: PreviewState, card: SampleCard) {
  return (
    !/^review-[1-4]$/.test(card.id) &&
    !state.reviewEvents.some((event) => event.cardId === card.id && event.saved)
  );
}

function reviewQueue(state: PreviewState) {
  const active = state.cards.filter((card) => card.status === "active");
  return [
    ...active.filter((card) => !isSampleNewCard(state, card)),
    ...(state.preferences.newCards
      ? active.filter((card) => isSampleNewCard(state, card)).slice(0, 2)
      : []),
  ];
}

function beginReview(state: PreviewState, ids: string[]) {
  return {
    ...state,
    reviewCursor: 0,
    reviewSessionIds: ids,
    reviewStartedAt: Date.now(),
    reviewSessionEventIds: [],
    cards: state.cards.map((card) =>
      ids.includes(card.id) && card.status === "suggested"
        ? { ...card, status: "active" as const }
        : card,
    ),
  };
}

function Review() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const due = state.cards.filter(
    (card) => card.status === "active" && !isSampleNewCard(state, card),
  ).length;
  const newCount = state.cards.filter(
    (card) => card.status === "active" && isSampleNewCard(state, card),
  ).length;
  const queue = reviewQueue(state);
  return (
    <div className={styles.layout}>
      <PageHeader
        title="A few minutes of practice"
        description="A short review is enough. Review history stays in this sample workspace."
      />
      <Panel title="Today’s cards" tone="hero">
        <dl className={styles.metrics}>
          <div>
            <dt>Due sample cards</dt>
            <dd>{due}</dd>
          </div>
          <div>
            <dt>Approved new cards</dt>
            <dd>{newCount}</dd>
          </div>
          <div>
            <dt>In this review</dt>
            <dd>{queue.length}</dd>
          </div>
        </dl>
        <p className={styles.muted}>
          The first 4 sample cards are treated as due. Newly added cards count as new until their
          first saved answer. No real schedule or due dates are calculated.
        </p>
        <Button
          disabled={!queue.length}
          onClick={() => {
            setState((previous) =>
              beginReview(
                previous,
                queue.map((card) => card.id),
              ),
            );
            announce("A new sample review has started.");
            router.push("/preview/review-card");
          }}
        >
          Start review
        </Button>
      </Panel>
      <div className="workspace-grid">
        <Panel title="Keep the review manageable">
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.preferences.newCards}
              onChange={(event) => {
                const checked = event.target.checked;
                setState((previous) => ({
                  ...previous,
                  preferences: { ...previous.preferences, newCards: checked },
                }));
              }}
            />
            Include up to 2 approved new cards
          </label>
          <p className={styles.muted}>
            Pause new cards whenever you prefer to focus on cards you already added.
          </p>
          <LinkButton to="cards" secondary>
            Choose new cards from suggestions
          </LinkButton>
        </Panel>
        <Panel title="How do you want to answer?">
          <fieldset className={styles.choices}>
            <legend>Review mode</legend>
            {(
              [
                ["simple", "Simple · Forgot / Remembered"],
                ["advanced", "Advanced · Again / Hard / Good / Easy"],
              ] as const
            ).map(([value, label]) => (
              <label className={styles.check} key={value}>
                <input
                  type="radio"
                  name="rating-mode"
                  checked={state.preferences.ratingMode === value}
                  onChange={() =>
                    setState((previous) => ({
                      ...previous,
                      preferences: { ...previous.preferences, ratingMode: value },
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        </Panel>
      </div>
      {!queue.length ? (
        <Status>Add a card from your session notes to start a sample review.</Status>
      ) : null}
      <Actions>
        <LinkButton to="cards" secondary>
          Manage cards
        </LinkButton>
        <LinkButton to="preferences" secondary>
          Review settings
        </LinkButton>
      </Actions>
    </div>
  );
}

function ReviewCard({ revealed }: { revealed: boolean }) {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const ids =
    state.reviewStartedAt !== null
      ? state.reviewSessionIds
      : reviewQueue(state).map((card) => card.id);
  const card = state.cards.find((item) => item.id === ids[state.reviewCursor]);
  const unsaved = state.reviewEvents.find(
    (event) =>
      state.reviewSessionEventIds.includes(event.id) && event.cardId === card?.id && !event.saved,
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function save(eventId: string, forceFailure: boolean) {
    lock.current = true;
    setPending(true);
    setFailed(false);
    timer.current = setTimeout(() => {
      setPending(false);
      lock.current = false;
      if (forceFailure) {
        setFailed(true);
        setFailNext(false);
        announce(
          "Sample answer was not saved. Retry keeps the same answer and does not create another event.",
        );
        return;
      }
      setState((previous) => {
        const event = previous.reviewEvents.find((item) => item.id === eventId);
        if (!event || event.saved) return previous;
        return {
          ...previous,
          reviewEvents: previous.reviewEvents.map((item) =>
            item.id === eventId ? { ...item, saved: true } : item,
          ),
          reviewCursor: previous.reviewCursor + 1,
        };
      });
      announce("Sample answer saved locally.");
      router.push(
        state.reviewCursor + 1 >= ids.length ? "/preview/review-summary" : "/preview/review-card",
      );
    }, 400);
  }
  function rate(rating: Rating) {
    if (!card || lock.current || unsaved) return;
    lock.current = true;
    const eventId = makeId("review");
    setState((previous) => {
      const base = previous.reviewStartedAt !== null ? previous : beginReview(previous, ids);
      return {
        ...base,
        reviewEvents: [
          ...base.reviewEvents,
          { id: eventId, cardId: card.id, rating, saved: false },
        ],
        reviewSessionEventIds: [...base.reviewSessionEventIds, eventId],
      };
    });
    save(eventId, failNext);
  }
  if (!card)
    return (
      <div className={styles.layout}>
        <PageHeader title="Your sample review is finished" />
        <Panel>
          <p>There are no more cards in this review.</p>
          <LinkButton to="review-summary">View summary</LinkButton>
          <LinkButton to="review" secondary>
            Choose another review
          </LinkButton>
        </Panel>
      </div>
    );
  if (card.status !== "active")
    return (
      <div className={styles.layout}>
        <PageHeader title="This card is out of your review queue" back="review" />
        <Panel>
          <p>The sample card is {card.status}. No answer has been graded.</p>
          <Button
            onClick={() => {
              setState((previous) => ({
                ...previous,
                reviewSessionIds: previous.reviewSessionIds.filter((id) => id !== card.id),
              }));
              router.push("/preview/review-card");
            }}
          >
            Continue without this card
          </Button>
        </Panel>
      </div>
    );
  const ratings: [Rating, string][] =
    state.preferences.ratingMode === "advanced"
      ? [
          ["again", "Again"],
          ["hard", "Hard"],
          ["good", "Good"],
          ["easy", "Easy"],
        ]
      : [
          ["forgot", "Forgot"],
          ["remembered", "Remembered"],
        ];
  return (
    <div className={`${styles.layout} ${styles.review}`}>
      <PageHeader
        title={revealed ? "Compare your answer" : "A moment to remember"}
        description={`Card ${state.reviewCursor + 1} of ${ids.length} · Sample review`}
        back="review"
      />
      <article className={styles.flashcard}>
        <span className="workspace-chip">{TYPES[card.type]}</span>
        <CardInstruction type={card.type} />
        <h2>{card.question}</h2>
        {card.type === "listening" ? <ComputerVoice text={card.answer} /> : null}
        <SourceLabel source={card.source} classId={card.classId} />
        {revealed ? (
          <div className={styles.answer}>{card.answer}</div>
        ) : (
          <Button
            onClick={() => {
              if (state.reviewStartedAt === null)
                setState((previous) => beginReview(previous, ids));
              router.push("/preview/review-answer");
            }}
          >
            Show answer
          </Button>
        )}
      </article>
      {revealed ? (
        <Panel title="How did it go?">
          <p>Choose after you compare your answer.</p>
          {state.preferences.ratingMode === "advanced" ? (
            <p className={styles.muted}>
              Hard means you remembered, but with difficulty. Again means you did not remember.
            </p>
          ) : null}
          <div
            className={`${styles.ratings} ${state.preferences.ratingMode === "advanced" ? styles.ratingsAdvanced : ""}`}
          >
            {ratings.map(([value, label]) => (
              <Button
                key={value}
                secondary={value === "forgot" || value === "again" || value === "hard"}
                disabled={pending || !!unsaved}
                onClick={() => rate(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {pending ? (
            <Status>Saving this sample answer…</Status>
          ) : unsaved || failed ? (
            <div className="workspace-stack">
              <Status tone="error">This sample answer is not saved. Retry before moving on.</Status>
              <Button
                onClick={() => {
                  if (!lock.current && unsaved) save(unsaved.id, false);
                }}
              >
                Retry sample save
              </Button>
            </div>
          ) : (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={failNext}
                onChange={(event) => setFailNext(event.target.checked)}
              />
              Demonstrate a save problem on the next answer
            </label>
          )}
        </Panel>
      ) : null}
      <Actions>
        <Button
          secondary
          disabled={pending}
          onClick={() => {
            setState((previous) => ({
              ...previous,
              selectedCardId: card.id,
              classes: previous.classes.some((lesson) => lesson.id === card.classId)
                ? [
                    ...previous.classes.filter((lesson) => lesson.id === card.classId),
                    ...previous.classes.filter((lesson) => lesson.id !== card.classId),
                  ]
                : previous.classes,
            }));
            router.push("/preview/card-editor");
          }}
        >
          Card options
        </Button>
        <LinkButton to="review-summary" secondary>
          End for now
        </LinkButton>
      </Actions>
      <p className={styles.muted}>
        Answers are stored in this preview only. No real review schedule is changed.
      </p>
    </div>
  );
}

function ReviewSummary() {
  const { state } = usePreview();
  const session = state.reviewEvents.filter((event) =>
    state.reviewSessionEventIds.includes(event.id),
  );
  const saved = session.filter((event) => event.saved);
  const remembered = saved.filter((event) =>
    ["remembered", "hard", "good", "easy"].includes(event.rating),
  ).length;
  const pending = session.filter((event) => !event.saved).length;
  return (
    <div className={styles.layout}>
      <PageHeader
        title={
          saved.length
            ? "You made time for your English."
            : "A little practice is ready when you are."
        }
        description="A factual summary of this sample review."
      />
      <Panel title="Your review" tone="hero">
        <dl className={styles.metrics}>
          <div>
            <dt>Answers saved</dt>
            <dd>{saved.length}</dd>
          </div>
          <div>
            <dt>Remembered</dt>
            <dd>{remembered}</dd>
          </div>
          <div>
            <dt>To practise again</dt>
            <dd>{saved.length - remembered}</dd>
          </div>
        </dl>
        <p>
          {Math.max(0, state.reviewSessionIds.length - saved.length)} cards remain in the sample
          review. You do not have to finish them now.
        </p>
        {pending ? (
          <Status tone="error">
            {pending} sample answer is not saved and is excluded from this summary.
          </Status>
        ) : null}
        {pending ? <LinkButton to="review-answer">Retry unsaved answer</LinkButton> : null}
      </Panel>
      <Panel title="Keep it small">
        <p>
          Your sample review history stays in this preview. These counts describe your answers, not
          your English level.
        </p>
      </Panel>
      <Actions>
        <LinkButton to="today">Back to Today</LinkButton>
        <LinkButton to="progress" secondary>
          View progress
        </LinkButton>
        <LinkButton to="review" secondary>
          Review again
        </LinkButton>
      </Actions>
    </div>
  );
}

function Progress() {
  const { state } = usePreview();
  const saved = state.reviewEvents.filter((event) => event.saved);
  const distinct = new Set(saved.map((event) => event.cardId)).size;
  const again = saved.filter(
    (event) => event.rating === "again" || event.rating === "forgot",
  ).length;
  return (
    <div className={styles.layout}>
      <PageHeader
        title="Your learning progress"
        description="See what you have practised, without turning it into a score."
        back="profile"
      />
      <dl className={styles.metrics}>
        <div>
          <dt>Sample answers saved</dt>
          <dd>{saved.length}</dd>
        </div>
        <div>
          <dt>Different cards practised</dt>
          <dd>{distinct}</dd>
        </div>
        <div>
          <dt>Answers to practise again</dt>
          <dd>{again}</dd>
        </div>
      </dl>
      <div className="workspace-grid">
        <Panel title="What you are practising">
          {saved.length ? (
            <ul className={styles.activity}>
              {Object.entries(TYPES).map(([type, label]) => {
                const count = saved.filter(
                  (event) => state.cards.find((card) => card.id === event.cardId)?.type === type,
                ).length;
                return count ? (
                  <li key={type}>
                    <span>{label}</span>
                    <strong>
                      {count} {count === 1 ? "answer" : "answers"}
                    </strong>
                    <progress
                      value={count}
                      max={saved.length}
                      aria-label={`${label}: ${count} of ${saved.length} sample answers`}
                    />
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p>No sample answers yet. Start a short review to see your practice here.</p>
          )}
          <LinkButton to="review">Open review</LinkButton>
        </Panel>
        <Panel title="Your English level">
          <h3>
            {state.profile.level || "Not chosen"}{" "}
            <span className="workspace-chip">Chosen by you</span>
          </h3>
          <p>This is your own view, not a language test.</p>
          <p className={styles.muted}>
            An estimated level is not available. This sample has no evidence for an official
            assessment.
          </p>
          <LinkButton to="edit-goal" secondary>
            Edit level and goal
          </LinkButton>
        </Panel>
      </div>
      <Panel title="Your learning space">
        <p>
          {state.cards.filter((card) => card.status === "active").length} active cards ·{" "}
          {state.classes.length} sample sessions.
        </p>
        <p className={styles.muted}>
          Counts use your changes in this preview. No activity from a real account is included.
        </p>
        <LinkButton to="classes" secondary>
          View courses
        </LinkButton>
      </Panel>
    </div>
  );
}

export function LearningViews({ screen }: { screen: string }) {
  const { state } = usePreview();
  switch (screen) {
    case "notes":
      return <Notes />;
    case "source":
      return <Source />;
    case "edit-notes":
      return <EditNotes />;
    case "history":
      return <History />;
    case "transcript":
      return <Transcript />;
    case "export":
      return <ExportNotes />;
    case "cards":
      return <Cards />;
    case "card-types":
      return <CardTypes />;
    case "card-editor":
      return (
        <CardEditor
          key={
            state.selectedCardId ??
            state.cards.find(
              (card) => card.classId === state.classes[0]?.id && card.status !== "deleted",
            )?.id ??
            "default"
          }
        />
      );
    case "card-update":
      return <CardUpdate />;
    case "review":
      return <Review />;
    case "review-card":
      return <ReviewCard key={`front-${state.reviewCursor}`} revealed={false} />;
    case "review-answer":
      return <ReviewCard key={`answer-${state.reviewCursor}`} revealed />;
    case "review-summary":
      return <ReviewSummary />;
    case "progress":
      return <Progress />;
    default:
      return <PageHeader title="Choose a learning screen" back="today" />;
  }
}
