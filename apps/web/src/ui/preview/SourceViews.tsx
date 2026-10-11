"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileSelectionQueue } from "../components/FileSelectionQueue";
import { Sheet } from "../components/Sheet";
import { UploadProgress } from "../components/UploadProgress";
import { retryAllowanceCopy } from "../retry-allowance-copy";
import { appendSelectedFiles, type SelectedFile } from "../workspace/file-selection";
import { createSampleState, type SampleSource, usePreview } from "./PreviewContext";
import { Actions, Button, Field, LinkButton, PageHeader, Panel, Status } from "./primitives";
import { PREPARED_SAMPLE_MATERIAL, sampleClassSummary } from "./sample-material";
import {
  confirmedSources,
  selectedCost,
  sourceHasDetails,
  sourceIsReady,
  sourceUsesPart,
  withFullExtent,
  withPreparedSampleDetails,
} from "./source-model";

export { selectedCost } from "./source-model";

export function SourceViews({ screen }: { screen: string }) {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const [rights, setRights] = useState(false);
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [uploadComplete, setUploadComplete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFeedback = useRef<HTMLDivElement>(null);
  const addingLock = useRef(false);
  const [upload, setUpload] = useState<{
    total: number;
    completed: number;
    currentFile: string;
    percent: number;
    startedAt: number;
  } | null>(null);
  const uploading = upload !== null;
  useEffect(() => {
    if (!selectedFiles.length && !uploading) return;
    const preventLosingSelection = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLosingSelection);
    return () => window.removeEventListener("beforeunload", preventLosingSelection);
  }, [selectedFiles.length, uploading]);
  useEffect(() => {
    if (uploading) uploadFeedback.current?.scrollIntoView({ block: "center" });
  }, [uploading]);
  const savingLock = useRef(false);
  const processingLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [cancel, setCancel] = useState(false);
  const [network, setNetwork] = useState(true);
  useEffect(() => {
    if (
      !state.recording.active ||
      state.recording.paused ||
      !["recording", "stop-recording"].includes(screen)
    )
      return;
    const timer = setInterval(
      () =>
        setState((previous) =>
          previous.recording.active && !previous.recording.paused
            ? {
                ...previous,
                recording: { ...previous.recording, elapsed: previous.recording.elapsed + 1 },
              }
            : previous,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [screen, state.recording.active, state.recording.paused, setState]);
  const cost = selectedCost(state.sources),
    over = cost.minutes > state.allowance.minutes || cost.pages > state.allowance.pages;
  const needsAction = state.sources.some((source) => source.selected && !sourceIsReady(source));
  const { elapsed, photos: photoCount } = state.recording;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const patchSource = (id: string, patch: Partial<SampleSource>) =>
    setState((prev) => ({
      ...prev,
      sources: prev.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    }));
  function selectFiles(files: FileList | null) {
    if (!files?.length || addingLock.current) return;
    const picked = Array.from(files);
    setSelectedFiles((previous) =>
      appendSelectedFiles(previous, picked).map((item) => ({
        ...item,
        problem: /\.(pdf|jpe?g|png|webp|m4a|mp3|wav|webm|ogg)$/i.test(item.file.name)
          ? item.problem
          : `“${item.file.name}” is not a supported sample file. Remove it and choose audio, PDF or a photo.`,
      })),
    );
    setProblem("");
    setUploadComplete(false);
  }
  async function addFiles() {
    if (!selectedFiles.length || selectedFiles.some((item) => item.problem) || addingLock.current)
      return;
    const submittedIds = new Set(selectedFiles.map((item) => item.id));
    setProblem("");
    setUploadComplete(false);
    const next: SampleSource[] = [];
    for (const { file } of selectedFiles) {
      const kind = /\.pdf$/i.test(file.name)
        ? "pdf"
        : /\.(jpe?g|png|webp)$/i.test(file.name)
          ? "photo"
          : /\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)
            ? "audio"
            : null;
      if (!kind) {
        setProblem(`“${file.name}” is not a supported sample file. Choose audio, PDF or a photo.`);
        continue;
      }
      next.push(
        withPreparedSampleDetails({
          id: crypto.randomUUID(),
          name: file.name,
          kind,
          durationMinutes: 0,
          pages: kind === "photo" ? 1 : 0,
          selected: kind === "photo",
          role: "Class material",
          status:
            kind === "pdf" && /password|locked/i.test(file.name)
              ? "Needs password"
              : kind === "photo"
                ? "Received"
                : "Needs details",
          rangeStart: kind === "audio" ? 0 : 1,
          rangeEnd: kind === "photo" ? 1 : 0,
        }),
      );
    }
    if (!next.length) return;
    addingLock.current = true;
    const classId = state.classes[0]?.id;
    const startedAt = Date.now();
    setUpload({
      total: next.length,
      completed: 0,
      currentFile: next[0]?.name ?? "",
      percent: 0,
      startedAt,
    });
    announce("Upload demonstration started. File bytes stay on your device.");
    for (const [index, source] of next.entries()) {
      for (let step = 1; step <= 4; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (mounted.current)
          setUpload({
            total: next.length,
            completed: index,
            currentFile: source.name,
            percent: Math.round(((index + step / 4) / next.length) * 100),
            startedAt,
          });
      }
      setState((previous) =>
        previous.classes[0]?.id !== classId
          ? classId && previous.classWorkspaces[classId]
            ? {
                ...previous,
                classWorkspaces: {
                  ...previous.classWorkspaces,
                  [classId]: {
                    ...previous.classWorkspaces[classId],
                    sources: [source, ...previous.classWorkspaces[classId].sources],
                  },
                },
              }
            : previous
          : { ...previous, sources: [source, ...previous.sources] },
      );
      if (mounted.current)
        setUpload({
          total: next.length,
          completed: index + 1,
          currentFile: next[index + 1]?.name ?? source.name,
          percent: Math.round(((index + 1) / next.length) * 100),
          startedAt,
        });
    }
    addingLock.current = false;
    if (mounted.current) {
      setUpload(null);
      setSelectedFiles((previous) => previous.filter((item) => !submittedIds.has(item.id)));
      setUploadComplete(true);
    }
    announce("File names added to this sample. File bytes have not been uploaded.");
  }
  async function saveRecording() {
    if (savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    const classId = state.classes[0]?.id;
    if (!classId || elapsed <= 0) {
      savingLock.current = false;
      setSaving(false);
      setProblem("Start a session and keep at least one sample second before saving.");
      return;
    }
    const duration = elapsed / 60;
    const id = crypto.randomUUID();
    setState((previous) => ({
      ...previous,
      recording: { ...previous.recording, active: false, paused: false },
    }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    const source: SampleSource = {
      id,
      name: "Sample recording",
      kind: "audio",
      durationMinutes: duration,
      pages: 0,
      selected: true,
      role: "Class teaching",
      status: "Received",
      rangeStart: 0,
      rangeEnd: duration,
    };
    setState((prev) =>
      prev.classes[0]?.id !== classId
        ? prev.classWorkspaces[classId]
          ? {
              ...prev,
              classWorkspaces: {
                ...prev.classWorkspaces,
                [classId]: {
                  ...prev.classWorkspaces[classId],
                  sources: [...prev.classWorkspaces[classId].sources, source],
                },
              },
            }
          : prev
        : {
            ...prev,
            sources: [...prev.sources, source],
          },
    );
    announce("A sample recording entry was added. No microphone audio was captured.");
    if (mounted.current) router.push("/preview/saved");
  }
  function process() {
    if (state.processing === "queued" || state.processing === "retrying") {
      router.push("/preview/processing");
      return;
    }
    if (!cost.minutes && !cost.pages) {
      setProblem("Choose at least one source.");
      return;
    }
    if (needsAction) {
      setProblem("Resolve the selected sources that need attention first.");
      return;
    }
    if (over) {
      router.push("/preview/shortfall");
      return;
    }
    if (processingLock.current) return;
    processingLock.current = true;
    setState((prev) =>
      prev.processing === "queued" || prev.processing === "retrying"
        ? prev
        : {
            ...prev,
            processing: "queued",
            classes: prev.classes.map((lesson, index) =>
              index === 0 ? { ...lesson, status: "In queue" } : lesson,
            ),
            processingSnapshot: confirmedSources(prev.sources),
            allowance: {
              minutes: Math.max(0, prev.allowance.minutes - cost.minutes),
              pages: Math.max(0, prev.allowance.pages - cost.pages),
            },
          },
    );
    setProblem("");
    router.push("/preview/processing");
  }
  function completeJob() {
    if (!state.processingSnapshot.length || !["queued", "retrying"].includes(state.processing))
      return;
    const template = createSampleState();
    setState((previous) => {
      const classId = previous.classes[0]?.id;
      if (!classId || !["queued", "retrying"].includes(previous.processing)) return previous;
      const hasNotes = !!previous.noteText.trim();
      const hasCards = previous.cards.some((card) => card.classId === classId);
      const completed = new Set(previous.processingSnapshot.map((source) => source.id));
      const materialMetadata = hasNotes
        ? (previous.materialMetadata ?? null)
        : PREPARED_SAMPLE_MATERIAL;
      return {
        ...previous,
        processing: "ready",
        classes: previous.classes.map((lesson, index) =>
          index === 0
            ? {
                ...lesson,
                title: sampleClassSummary(lesson, materialMetadata).title,
                status: "Ready",
              }
            : lesson,
        ),
        processingSnapshot: previous.processingSnapshot.map((source) => ({
          ...source,
          status: "Received",
        })),
        sources: previous.sources.map((source) =>
          completed.has(source.id) && source.status === "Needs retry"
            ? { ...source, status: "Received" }
            : source,
        ),
        noteText: hasNotes ? previous.noteText : template.noteText,
        materialMetadata,
        noteHistory: hasNotes
          ? previous.noteHistory
          : [
              {
                id: crypto.randomUUID(),
                text: template.noteText,
                label: "Authored sample result · not extracted from files",
              },
            ],
        transcript: previous.transcript || template.transcript,
        cards: hasCards
          ? previous.cards
          : [
              ...previous.cards,
              ...template.cards
                .filter((card) => card.status === "suggested")
                .map((card) => ({
                  ...card,
                  id: crypto.randomUUID(),
                  classId,
                  source: "Authored sample · not extracted from files",
                })),
            ],
      };
    });
    announce(
      "Authored sample result is ready. Existing edits were kept; no AI service was called.",
    );
    router.push("/preview/notes");
  }
  const statusProblem = problem ? <Status tone="error">{problem}</Status> : null;
  if (screen === "first-upload")
    return (
      <div className="preview-reader">
        <PageHeader
          title="Before you add a file"
          description="Keep session material you are allowed to use."
          back="class"
        />
        <Panel title="Your class, with permission">
          <p>
            Only add material you own or have permission to use. Check your teacher’s rules before
            adding a session recording or handout.
          </p>
          <div className="preview-check">
            <input
              id="source-rights"
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            <label htmlFor="source-rights">I have the right to use the material I add.</label>
          </div>
          <p className="preview-muted">This sample stores file names only. No file is uploaded.</p>
        </Panel>
        <Actions>
          <Button disabled={!rights} onClick={() => router.push("/preview/upload")}>
            Continue to sources
          </Button>
          <LinkButton secondary to="class">
            Cancel
          </LinkButton>
        </Actions>
      </div>
    );
  if (screen === "microphone")
    return (
      <div className="preview-reader">
        <PageHeader
          title="Ready to record?"
          description="Check permission before your class starts."
          back="today"
        />
        <Panel title="Prepare your class">
          <p>Ask permission from your teacher and anyone whose voice may be recorded.</p>
          <p>This preview demonstrates recording controls. It does not turn on your microphone.</p>
          <Actions>
            <Button
              onClick={() => {
                setState((previous) => ({
                  ...previous,
                  recording: { ...previous.recording, active: true, paused: false },
                }));
                router.push("/preview/recording");
              }}
            >
              Start recording demonstration
            </Button>
            <LinkButton secondary to="first-upload">
              Add a file
            </LinkButton>
          </Actions>
          <Button
            secondary
            onClick={() =>
              setProblem(
                "Microphone access is blocked. In the live app, allow it in your browser settings, then try again. You can add a file instead.",
              )
            }
          >
            Try blocked microphone state
          </Button>
          {statusProblem}
        </Panel>
      </div>
    );
  if (["recording", "recording-paused"].includes(screen))
    return (
      <>
        <PageHeader
          title={screen === "recording" ? "Recording your session" : "Recording paused"}
          description="Recording demonstration · no microphone capture in this preview."
        />
        <Panel>
          <p className="preview-timer">{clock}</p>
          <div className="preview-meter">
            <strong>
              {!state.recording.active
                ? "Ready for a demonstration"
                : state.recording.paused
                  ? "Paused"
                  : "● Recording demonstration"}
            </strong>
            {photoCount ? <span>{photoCount} sample photos</span> : null}
          </div>
          <div className="preview-record-controls">
            <Button
              secondary
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  recording: { ...prev.recording, photos: prev.recording.photos + 1 },
                  sources: [
                    ...prev.sources,
                    {
                      id: crypto.randomUUID(),
                      name: `Sample whiteboard at ${clock}`,
                      kind: "photo",
                      durationMinutes: 0,
                      pages: 1,
                      selected: true,
                      role: "Class material",
                      status: "Received",
                      rangeStart: 1,
                      rangeEnd: 1,
                    },
                  ],
                }));
              }}
            >
              Photo
            </Button>
            <Button
              className="preview-pause"
              onClick={() => {
                const paused = state.recording.active && !state.recording.paused;
                setState((previous) => ({
                  ...previous,
                  recording: { ...previous.recording, active: true, paused },
                }));
                router.push(paused ? "/preview/recording-paused" : "/preview/recording");
              }}
            >
              {!state.recording.active
                ? "Start demonstration"
                : state.recording.paused
                  ? "Resume"
                  : "Pause"}
            </Button>
            <LinkButton secondary to="stop-recording">
              Stop
            </LinkButton>
          </div>
        </Panel>
        <Panel title="Keep this page open">
          <p>Pause before you step away. Photos here are sample entries; the camera is not used.</p>
        </Panel>
      </>
    );
  if (screen === "stop-recording")
    return (
      <>
        <PageHeader title="Finish this recording?" description="Choose what happens next." />
        <Panel title="Present perfect">
          <p>{clock} · sample recording</p>
          <p className="preview-muted">
            {state.recording.paused
              ? "The demonstration is paused."
              : state.recording.active
                ? "The demonstration clock continues until you confirm Stop."
                : "Prepared recording example; no microphone audio exists."}
          </p>
          <p>You can choose whether to process it next.</p>
        </Panel>
        <Actions>
          <Button disabled={saving} onClick={() => void saveRecording()}>
            {saving ? "Adding sample…" : "Stop and keep recording"}
          </Button>
          <LinkButton secondary to={state.recording.paused ? "recording-paused" : "recording"}>
            Continue recording
          </LinkButton>
        </Actions>
      </>
    );
  if (screen === "recording-failed" || screen === "recovery")
    return (
      <>
        <PageHeader
          title={screen === "recovery" ? "An unfinished recording" : "The microphone stopped"}
          description="A clear next step for the saved part."
        />
        <Panel title={`${clock} · sample recovery`}>
          <p>
            {screen === "recovery"
              ? "An interrupted session recording can be recovered when its saved part is available."
              : "The recording was interrupted. Check microphone permission before trying again."}
          </p>
          <p className="preview-muted">
            This is a demonstration of recovery. No audio file is held by this preview.
          </p>
        </Panel>
        <Actions>
          <Button disabled={saving} onClick={() => void saveRecording()}>
            {saving ? "Adding sample…" : "Keep saved part"}
          </Button>
          <LinkButton secondary to="microphone">
            Try microphone again
          </LinkButton>
          <Button secondary onClick={() => setCancel(true)}>
            Discard sample recovery
          </Button>
        </Actions>
        <Sheet
          open={cancel}
          title="Discard this recovery example?"
          onClose={() => setCancel(false)}
        >
          <p>You can return to this sample state from Explore screens.</p>
          <Actions>
            <Button
              onClick={() => {
                setState((previous) => ({
                  ...previous,
                  recording: { elapsed: 0, photos: 0, paused: false, active: false },
                }));
                announce(
                  "Unfinished recording demonstration discarded. No audio file was deleted.",
                );
                router.push("/preview/today");
              }}
            >
              Discard sample
            </Button>
            <Button secondary onClick={() => setCancel(false)}>
              Keep it
            </Button>
          </Actions>
        </Sheet>
      </>
    );
  if (screen === "saved")
    return (
      <>
        <PageHeader
          title="Your recording is ready"
          description="Sample entry · no audio was captured."
        />
        <Panel title="Choose your next step">
          <p>
            Keep the original recording on your own device in the live app. Here you can explore the
            processing estimate using sample durations.
          </p>
          <Actions>
            <LinkButton to="estimate">View estimate</LinkButton>
            <LinkButton secondary to="class">
              Go to session
            </LinkButton>
          </Actions>
        </Panel>
      </>
    );
  if (screen === "upload")
    return (
      <>
        <PageHeader
          title="Add session material"
          description="Audio, a handout or a whiteboard photo."
          back="class"
        />
        <Panel title="Choose files">
          <Actions>
            <Button disabled={!!upload} onClick={() => fileInput.current?.click()}>
              {state.sources.length || selectedFiles.length ? "Add More Files" : "Add Files"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              hidden
              aria-label="Add sample file names"
              disabled={!!upload}
              multiple
              accept=".m4a,.mp3,.wav,.webm,.ogg,.pdf,.jpg,.jpeg,.png,.webp"
              onChange={(event) => {
                selectFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </Actions>
          <p className="preview-muted">
            Supported examples: M4A, MP3, WAV, WEBM, OGG, PDF, JPG, PNG and WEBP. File content stays
            untouched.
          </p>
          <p className="preview-muted">
            File formats are identified from their names. Prepared sample durations and page counts
            are assigned automatically; this preview does not inspect file contents.
          </p>
          <FileSelectionQueue
            files={selectedFiles}
            busy={uploading}
            disabled={selectedFiles.some((item) => !!item.problem)}
            remove={(id) =>
              setSelectedFiles((previous) => previous.filter((item) => item.id !== id))
            }
            submit={() => void addFiles()}
            description="Choose Upload & Process to run the sample. File bytes stay on your device; no AI service is called."
            uploadHelp={false}
          />
          {uploadComplete ? (
            <Status tone="success">
              Sample upload successful. File names added to this sample. File bytes have not been
              uploaded.
            </Status>
          ) : null}
          {statusProblem}
        </Panel>
        <Panel title="Your sources">
          {upload ? (
            <div ref={uploadFeedback}>
              <UploadProgress
                label="Upload demonstration progress"
                status={`Upload demonstration · ${upload.completed} of ${upload.total} files added`}
                value={upload.percent}
                detail={`Adding ${upload.currentFile}. Simulated progress; no file bytes are uploaded.`}
                startedAt={upload.startedAt}
                active
              />
            </div>
          ) : null}
          <ul className="preview-list">
            {state.sources.map((source) => (
              <li key={source.id}>
                <div className="preview-row">
                  <div>
                    <strong>{source.name}</strong>
                    <p className="preview-muted">{source.status}</p>
                  </div>
                  <Button
                    secondary
                    disabled={
                      !["Received", "Needs details", "Upload paused"].includes(source.status)
                    }
                    onClick={() =>
                      patchSource(source.id, {
                        status:
                          source.status === "Upload paused"
                            ? sourceHasDetails(source)
                              ? "Received"
                              : "Needs details"
                            : "Upload paused",
                      })
                    }
                  >
                    {source.status === "Upload paused"
                      ? "Resume upload example"
                      : "Pause upload example"}
                  </Button>
                  <Button
                    secondary
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        sources: prev.sources.filter((item) => item.id !== source.id),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
                {source.status === "Needs password" ? (
                  <div>
                    <Field label="PDF password">
                      <input
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Button
                      disabled={!password}
                      onClick={() => {
                        patchSource(source.id, {
                          status: sourceHasDetails(source) ? "Received" : "Needs details",
                        });
                        setPassword("");
                        announce("Sample password step completed. The PDF has not been read.");
                      }}
                    >
                      Continue sample password step
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <Actions>
            <Button
              secondary
              disabled={!!upload}
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  sources: [
                    ...prev.sources,
                    {
                      id: crypto.randomUUID(),
                      name: "Protected sample PDF",
                      kind: "pdf",
                      durationMinutes: 0,
                      pages: 2,
                      selected: true,
                      role: "Class material",
                      status: "Needs password",
                      rangeStart: 1,
                      rangeEnd: 2,
                    },
                  ],
                }));
              }}
            >
              Try protected PDF
            </Button>
            <Button
              secondary
              disabled={!!upload}
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  sources: prev.sources.map((s, i) =>
                    i === 0 ? { ...s, status: "Not accepted" } : s,
                  ),
                }));
              }}
            >
              Try a file check failure
            </Button>
          </Actions>
        </Panel>
        <Actions>
          <LinkButton to="source-settings">Review sources</LinkButton>
          <LinkButton secondary to="class">
            Done
          </LinkButton>
        </Actions>
      </>
    );
  if (screen === "source-settings")
    return (
      <>
        <PageHeader
          title="Session sources"
          description="Use each whole file, or choose a part when you need it."
          back="class"
        />
        <div className="preview-stack">
          {state.sources.map((source) => (
            <Panel key={source.id} title={source.name}>
              <div className="preview-check">
                <input
                  id={`include-${source.id}`}
                  type="checkbox"
                  checked={source.selected}
                  disabled={!sourceIsReady(source)}
                  onChange={(e) => patchSource(source.id, { selected: e.target.checked })}
                />
                <label htmlFor={`include-${source.id}`}>
                  Include this source · {source.status}
                </label>
              </div>
              <p className="preview-muted">
                {source.kind === "audio"
                  ? `${source.durationMinutes} sample audio minutes in this file`
                  : source.kind === "photo"
                    ? "1 sample photo · entire source"
                    : `${source.pages} sample pages in this file`}
              </p>
              {source.kind !== "photo" ? (
                <fieldset className="preview-source-selection">
                  <legend>Material to process</legend>
                  <div className="preview-check">
                    <input
                      id={`whole-${source.id}`}
                      name={`extent-${source.id}`}
                      type="radio"
                      checked={!sourceUsesPart(source)}
                      onChange={() => patchSource(source.id, withFullExtent(source))}
                    />
                    <label htmlFor={`whole-${source.id}`}>Whole file</label>
                  </div>
                  <div className="preview-check">
                    <input
                      id={`part-${source.id}`}
                      name={`extent-${source.id}`}
                      type="radio"
                      checked={sourceUsesPart(source)}
                      disabled={!sourceHasDetails(source)}
                      onChange={() => patchSource(source.id, { selectionMode: "part" })}
                    />
                    <label htmlFor={`part-${source.id}`}>Part of file</label>
                  </div>
                  {sourceUsesPart(source) ? (
                    <div className="preview-grid">
                      <Field label={source.kind === "audio" ? "Start minute" : "First page"}>
                        <input
                          type="number"
                          min={source.kind === "audio" ? 0 : 1}
                          max={
                            source.kind === "audio"
                              ? Math.max(0, source.rangeEnd - 0.01)
                              : source.rangeEnd
                          }
                          step={source.kind === "audio" ? "0.01" : "1"}
                          value={source.rangeStart}
                          onChange={(event) =>
                            patchSource(source.id, {
                              rangeStart: Math.min(
                                source.kind === "audio"
                                  ? Math.max(0, source.rangeEnd - 0.01)
                                  : source.rangeEnd,
                                Math.max(
                                  source.kind === "audio" ? 0 : 1,
                                  source.kind === "audio"
                                    ? Number(event.target.value) || 0
                                    : Math.floor(Number(event.target.value)) || 1,
                                ),
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label={source.kind === "audio" ? "End minute" : "Last page"}>
                        <input
                          type="number"
                          min={
                            source.kind === "audio" ? source.rangeStart + 0.01 : source.rangeStart
                          }
                          max={source.kind === "audio" ? source.durationMinutes : source.pages}
                          step={source.kind === "audio" ? "0.01" : "1"}
                          value={source.rangeEnd}
                          onChange={(event) =>
                            patchSource(source.id, {
                              rangeEnd: Math.max(
                                source.kind === "audio"
                                  ? source.rangeStart + 0.01
                                  : source.rangeStart,
                                Math.min(
                                  source.kind === "audio" ? source.durationMinutes : source.pages,
                                  source.kind === "audio"
                                    ? Number(event.target.value) || 1
                                    : Math.floor(Number(event.target.value)) || 1,
                                ),
                              ),
                            })
                          }
                        />
                      </Field>
                    </div>
                  ) : null}
                </fieldset>
              ) : null}
              {source.status === "Needs details" ? (
                <div className="preview-stack">
                  <p className="preview-muted">
                    Use prepared sample details for this older preview entry. This preview has not
                    measured or checked the file.
                  </p>
                  <Button
                    onClick={() => {
                      patchSource(source.id, withPreparedSampleDetails(source));
                      announce("Prepared sample details applied. No file was uploaded or read.");
                    }}
                  >
                    Apply prepared sample details
                  </Button>
                </div>
              ) : null}
              <Button
                secondary
                disabled={!sourceIsReady(source)}
                onClick={() => {
                  patchSource(source.id, { selected: true });
                  announce("The existing source is reused. It is counted once.");
                }}
              >
                Reuse this source
              </Button>
            </Panel>
          ))}
        </div>
        <p className="preview-muted">
          These are prepared sample details. This preview stores file names and does not classify or
          measure uploaded contents.
        </p>
        <Actions>
          <LinkButton to="estimate">Continue to estimate</LinkButton>
          <LinkButton secondary to="class">
            Cancel
          </LinkButton>
        </Actions>
      </>
    );
  if (screen === "estimate")
    return (
      <>
        <PageHeader
          title="Check before processing"
          description="This estimate follows the selected sample files and any parts you chose."
          back="source-settings"
        />
        <div className="preview-grid">
          <Panel title="Selected material">
            <p>
              <strong>{cost.minutes} audio minutes</strong>
            </p>
            <p>
              <strong>{cost.pages} pages / photos</strong>
            </p>
            <ul>
              {state.sources
                .filter((s) => s.selected)
                .map((s) => (
                  <li key={s.id}>
                    {s.name} ·{" "}
                    {s.kind === "audio"
                      ? sourceUsesPart(s)
                        ? `${s.rangeStart}–${s.rangeEnd} min`
                        : `${s.durationMinutes} min · whole file`
                      : s.kind === "photo"
                        ? "1 photo"
                        : sourceUsesPart(s)
                          ? `pages ${s.rangeStart}–${s.rangeEnd}`
                          : `${s.pages} pages · whole file`}
                  </li>
                ))}
            </ul>
          </Panel>
          <Panel title="Your sample allowance">
            <p>{state.allowance.minutes} audio minutes available</p>
            <p>{state.allowance.pages} pages / photos available</p>
            <p className="preview-muted">
              No real processing, cost or allowance is affected. Reusing the same source counts
              once.
            </p>
            <Button
              secondary
              onClick={() =>
                setState((prev) => ({ ...prev, allowance: { minutes: 10, pages: 3 } }))
              }
            >
              Try insufficient allowance
            </Button>
          </Panel>
        </div>
        {over ? (
          <Status tone="error">
            The selected material exceeds the available sample allowance.
          </Status>
        ) : (
          <Status tone="success">The selected material fits.</Status>
        )}
        {needsAction ? (
          <Status tone="error">
            A selected source needs attention. Return to Add session material or exclude it.
          </Status>
        ) : null}
        {statusProblem}
        <Actions>
          <Button
            disabled={needsAction || (!cost.minutes && !cost.pages)}
            onClick={() => process()}
          >
            Process selected sources
          </Button>
          <LinkButton secondary to="source-settings">
            Change selection
          </LinkButton>
          <LinkButton secondary to="upload">
            Resolve source issues
          </LinkButton>
        </Actions>
      </>
    );
  if (screen === "shortfall")
    return (
      <>
        <PageHeader
          title="Choose what to process"
          description="Choose sources or file portions within your allowance."
          back="estimate"
        />
        <Panel title="Your selection is too large">
          <p>
            Selected: {cost.minutes} audio minutes and {cost.pages} pages / photos.
          </p>
          <p>
            Available: {state.allowance.minutes} audio minutes and {state.allowance.pages} pages /
            photos.
          </p>
          <Actions>
            <LinkButton to="class">Keep for later</LinkButton>
            <LinkButton secondary to="source-settings">
              Choose sources or file portions
            </LinkButton>
            <Button
              secondary
              onClick={() =>
                setProblem(
                  "Original files are not held by this sample. In the live app, download your saved original or keep the copy on your device.",
                )
              }
            >
              Keep an original copy
            </Button>
            <Button
              secondary
              onClick={() =>
                setProblem(
                  "A pilot operator is not configured in this sample. Ask your class organiser before processing more material.",
                )
              }
            >
              Contact pilot operator
            </Button>
          </Actions>
          {statusProblem}
        </Panel>
      </>
    );
  if (screen === "processing")
    return (
      <>
        <PageHeader
          title="Making your session notes"
          description="Processing demonstration · authored sample content."
          back="class"
        />
        <Panel
          title={state.processing === "queued" ? "Waiting in the queue" : "Processing example"}
        >
          {!state.processingSnapshot.length ||
          !["queued", "retrying"].includes(state.processing) ? (
            <div className="preview-stack">
              <Status>
                No active confirmed sample job. Check the selected material and allowance before
                starting.
              </Status>
              <LinkButton to="estimate">View estimate</LinkButton>
            </div>
          ) : null}
          <ol className="preview-list">
            <li>1. Check selected material</li>
            <li>2. Prepare transcript and source references</li>
            <li>3. Make notes and suggested cards</li>
          </ol>
          <p className="preview-muted">
            You can leave this screen and return to the session. This preview does not call an AI
            service.
          </p>
          <Actions>
            <Button
              disabled={
                !state.processingSnapshot.length ||
                !["queued", "retrying"].includes(state.processing)
              }
              onClick={completeJob}
            >
              Complete sample processing
            </Button>
            <Button
              secondary
              disabled={
                !state.processingSnapshot.length ||
                !["queued", "retrying"].includes(state.processing)
              }
              onClick={() => {
                const failed =
                  state.processingSnapshot.find((source) => source.kind === "audio") ??
                  state.processingSnapshot[0];
                if (!failed) return;
                const template = createSampleState();
                setState((prev) => ({
                  ...prev,
                  processing: prev.processingSnapshot.length > 1 ? "partial" : "failed",
                  classes: prev.classes.map((lesson, index) =>
                    index === 0
                      ? {
                          ...lesson,
                          title: sampleClassSummary(
                            lesson,
                            prev.noteText
                              ? prev.materialMetadata
                              : prev.processingSnapshot.length > 1
                                ? PREPARED_SAMPLE_MATERIAL
                                : null,
                          ).title,
                          status: prev.processingSnapshot.length > 1 ? "Partly ready" : "Failed",
                        }
                      : lesson,
                  ),
                  processingSnapshot: prev.processingSnapshot.map((source) =>
                    source.id === failed.id
                      ? { ...source, status: "Needs retry" }
                      : { ...source, status: "Received" },
                  ),
                  sources: prev.sources.map((s) =>
                    s.id === failed.id ? { ...s, status: "Needs retry" } : s,
                  ),
                  noteText:
                    prev.noteText || (prev.processingSnapshot.length > 1 ? template.noteText : ""),
                  materialMetadata: prev.noteText
                    ? prev.materialMetadata
                    : prev.processingSnapshot.length > 1
                      ? PREPARED_SAMPLE_MATERIAL
                      : null,
                  noteHistory:
                    prev.noteText || prev.processingSnapshot.length <= 1
                      ? prev.noteHistory
                      : [
                          {
                            id: crypto.randomUUID(),
                            text: template.noteText,
                            label: "Authored partial sample · not extracted from files",
                          },
                        ],
                }));
                router.push("/preview/processing-result");
              }}
            >
              Try a partial result
            </Button>
            <LinkButton secondary to="class">
              View session
            </LinkButton>
            <Button
              secondary
              disabled={
                !state.processingSnapshot.length ||
                !["queued", "retrying"].includes(state.processing)
              }
              onClick={() => setCancel(true)}
            >
              Cancel processing
            </Button>
          </Actions>
        </Panel>
        <Sheet
          open={cancel}
          onClose={() => setCancel(false)}
          title="Cancel this processing example?"
        >
          <p>
            The original sample sources stay in the session. The current result can still be
            inspected.
          </p>
          <Actions>
            <Button
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  processing: "cancelled",
                  classes: prev.classes.map((lesson, index) =>
                    index === 0 ? { ...lesson, status: "Cancelled" } : lesson,
                  ),
                }));
                router.push("/preview/processing-result");
              }}
            >
              Cancel sample processing
            </Button>
            <Button secondary onClick={() => setCancel(false)}>
              Keep processing
            </Button>
          </Actions>
        </Sheet>
      </>
    );
  if (screen === "processing-result")
    return (
      <>
        <PageHeader
          title={
            state.processing === "cancelled"
              ? "Processing cancelled"
              : state.processing === "partial"
                ? "Your notes are partly ready"
                : state.processing === "ready"
                  ? "Your notes are ready"
                  : state.processing === "failed"
                    ? "The sample job needs another try"
                    : "No processing result yet"
          }
          description="Know which parts were used and what needs another try."
          back="class"
        />
        <Panel title="Confirmed job inputs">
          {!state.processingSnapshot.length ? (
            <Status>No processing job has been confirmed. Start with the estimate.</Status>
          ) : null}
          <ul className="preview-list">
            {state.processingSnapshot.map((source) => (
              <li key={source.id}>
                <strong>{source.name}</strong>
                <p className="preview-muted">
                  {source.kind === "audio"
                    ? `${source.rangeStart}–${source.rangeEnd} minutes`
                    : source.kind === "photo"
                      ? "1 photo"
                      : `Pages ${source.rangeStart}–${source.rangeEnd}`}{" "}
                  · fixed when you confirmed this job
                </p>
                <p className="preview-muted">
                  {state.processing === "cancelled"
                    ? "Cancelled · not completed"
                    : source.status === "Needs retry"
                      ? "Needs retry · this source is excluded from the partial notes"
                      : ["ready", "partial"].includes(state.processing)
                        ? "Included in sample result"
                        : "Waiting for this job"}
                </p>
              </li>
            ))}
          </ul>
          <p>{retryAllowanceCopy({ notesReady: !!state.noteText })}</p>
          <Actions>
            {["ready", "partial"].includes(state.processing) && state.noteText ? (
              <LinkButton to="notes">
                {state.processing === "ready" ? "Read notes" : "Read partial notes"}
              </LinkButton>
            ) : (
              <LinkButton to="estimate">View estimate</LinkButton>
            )}
            <Button
              secondary
              disabled={
                !state.processingSnapshot.some((source) => source.status === "Needs retry") ||
                !["partial", "failed"].includes(state.processing)
              }
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  processing: "retrying",
                  classes: prev.classes.map((lesson, index) =>
                    index === 0 ? { ...lesson, status: "Processing" } : lesson,
                  ),
                  processingSnapshot: prev.processingSnapshot.map((source) =>
                    source.status === "Needs retry" ? { ...source, status: "Retrying" } : source,
                  ),
                }));
                announce("Free sample retry started.");
                router.push("/preview/processing");
              }}
            >
              Retry failed source
            </Button>
            <LinkButton secondary to="class">
              Back to session
            </LinkButton>
          </Actions>
        </Panel>
      </>
    );
  if (screen === "states")
    return (
      <>
        <PageHeader
          title="A clear next step"
          description="Explore interruptions and recover without losing your place."
        />
        <Panel title={network ? "Ready to continue" : "You are offline"}>
          <p>
            {network
              ? "Your connection is available in this demonstration."
              : "This example keeps your sample changes on this device. Try again when connected."}
          </p>
          <Button onClick={() => setNetwork((value) => !value)}>
            {network ? "Try offline state" : "Retry connection"}
          </Button>
        </Panel>
        <div className="preview-grid">
          <Panel title="A file needs attention">
            <p>Return to the source and resolve its permission, password or file check.</p>
            <LinkButton secondary to="upload">
              View source issues
            </LinkButton>
          </Panel>
          <Panel title="An empty learning space">
            <p>Add a session, choose useful cards and start with a short review.</p>
            <LinkButton secondary to="new-class">
              Create a session
            </LinkButton>
          </Panel>
          <Panel title="Recording was interrupted">
            <p>Check the saved part before starting again.</p>
            <LinkButton secondary to="recovery">
              Try recovery
            </LinkButton>
          </Panel>
          <Panel title="Something did not finish">
            <p>Your sample edits are still here. Retry the unfinished step.</p>
            <LinkButton secondary to="processing-result">
              View partial result
            </LinkButton>
          </Panel>
        </div>
      </>
    );
  return null;
}
