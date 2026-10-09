"use client";

import { type ReactNode, useState } from "react";
import { Button, IconButton } from "../../../ui/components/Button";
import { Checkbox } from "../../../ui/components/Checkbox";
import { Bdi, ContentBlock } from "../../../ui/components/ContentBlock";
import {
  Banner,
  EmptyState,
  HeroCard,
  InlineError,
  Skeleton,
} from "../../../ui/components/Feedback";
import { Field, TextArea, TextInput } from "../../../ui/components/Field";
import { Icon } from "../../../ui/components/Icon";
import { RadioCards } from "../../../ui/components/RadioCards";
import { SegmentedControl } from "../../../ui/components/SegmentedControl";
import { ConfirmDialog, Sheet } from "../../../ui/components/Sheet";
import { Snackbar } from "../../../ui/components/Snackbar";
import {
  ClassStatusChip,
  ExperimentalBadge,
  ProvenanceBlock,
  ProvenanceLabel,
  SourceChip,
  SourceStatus,
} from "../../../ui/components/Status";
import { Switch } from "../../../ui/components/Switch";
import {
  ArrowsClockwise,
  Cards,
  CircleHalf,
  FilePdf,
  Flask,
  Image,
  PauseCircle,
  Plus,
  Trash,
  WifiSlash,
  X,
} from "../../../ui/icons";
import styles from "./UiKit.module.css";

// Sample text comes from the design frames, so each state can be compared with its frame.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`section-${title}`}>
      <h2 id={`section-${title}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ThemeSwitcher() {
  const setTheme = (theme: "light" | "dark") =>
    document.documentElement.setAttribute("data-theme", theme);
  return (
    <div className={styles.row}>
      <Button onClick={() => setTheme("light")}>Light theme</Button>
      <Button onClick={() => setTheme("dark")}>Dark theme</Button>
    </div>
  );
}

function Buttons() {
  const [presses, setPresses] = useState(0);
  return (
    <Section title="Buttons">
      <div className={styles.row}>
        <Button variant="primary" onClick={() => setPresses((n) => n + 1)}>
          Start review
        </Button>
        <Button>Later</Button>
        <Button variant="ghost" icon={Plus}>
          Ghost
        </Button>
        <Button variant="danger" icon={Trash}>
          Discard
        </Button>
        <IconButton icon={X} label="Close" />
      </div>
      <div className={styles.row}>
        <Button variant="primary" disabled>
          Start review
        </Button>
        <Button variant="primary" loading>
          Saving…
        </Button>
        <Button loading>Checking…</Button>
      </div>
      <div className={styles.stack}>
        <Button
          variant="primary"
          size="lg"
          block
          unavailable
          aria-describedby="continue-reason"
          onClick={() => setPresses((n) => n + 1)}
        >
          Continue with Google
        </Button>
        <p id="continue-reason" className={styles.note}>
          Please tick both boxes to continue.
        </p>
      </div>
      <p className={styles.note} aria-live="polite">
        Presses: <span data-testid="presses">{presses}</span>
      </p>
    </Section>
  );
}

function Fields() {
  const [title, setTitle] = useState("Present perfect vs past simple");
  return (
    <Section title="Text fields">
      <Field
        id="kit-title"
        label="Title (optional)"
        hint="If you don't choose, the session goes into &quot;My courses&quot;."
      >
        {(control) => (
          <TextInput
            {...control}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </Field>
      <Field id="kit-course" label="Course name" error="Please write a name.">
        {(control) => <TextInput {...control} defaultValue="" />}
      </Field>
      <Field id="kit-disabled" label="Disabled">
        {(control) => <TextInput {...control} defaultValue="English" disabled />}
      </Field>
      <Field id="kit-note" label="My note">
        {(control) => <TextArea {...control} defaultValue="Already = earlier than I thought." />}
      </Field>
    </Section>
  );
}

function Choices() {
  const [adult, setAdult] = useState(false);
  const [include, setInclude] = useState(true);
  const [autoAdd, setAutoAdd] = useState(false);
  const [exportType, setExportType] = useState<"notes" | "anki">("notes");
  const [quality, setQuality] = useState<"low" | "medium" | "original">("medium");
  const [explain, setExplain] = useState<"en" | "fa" | null>(null);
  const [deletion, setDeletion] = useState<"remove" | "original" | "all" | null>(null);
  return (
    <Section title="Choices">
      <Checkbox
        label="I am 18 or older"
        checked={adult}
        onChange={(e) => setAdult(e.target.checked)}
      />
      <Checkbox label="Board photos (2)" defaultChecked />
      <Checkbox label="Worksheet pages (4)" disabled />
      <div className={styles.row}>
        <Switch label="Include session recording" checked={include} onChange={setInclude} />
        <Switch label="Auto add" checked={autoAdd} onChange={setAutoAdd} />
        <Switch label="Include in processing" checked={false} onChange={() => {}} disabled />
      </div>
      <SegmentedControl
        name="kit-export"
        label="Export type"
        value={exportType}
        onChange={setExportType}
        options={[
          { value: "notes", label: "Notes file", icon: <Icon icon={FilePdf} /> },
          { value: "anki", label: "Anki cards", icon: <Icon icon={Cards} /> },
        ]}
      />
      <SegmentedControl
        name="kit-quality"
        label="Image quality"
        size="sm"
        value={quality}
        onChange={setQuality}
        options={[
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "original", label: "Original" },
        ]}
      />
      <RadioCards
        name="kit-explain"
        label="Explanations in"
        value={explain}
        onChange={setExplain}
        options={[
          { value: "en", title: "English" },
          { value: "fa", title: "فارسی", lang: "fa", meta: "Persian" },
        ]}
      />
      <RadioCards
        name="kit-delete"
        label="Delete a source"
        value={deletion}
        onChange={setDeletion}
        options={[
          {
            value: "remove",
            title: "Remove from this session",
            description: "The file stays for other sessions that use it. Notes don't change.",
          },
          {
            value: "original",
            title: "Delete the original, keep the notes",
            description:
              'Notes and cards stay. Source chips will say "The original file is no longer kept."',
          },
          {
            value: "all",
            title: "Delete completely",
            description: "Also removes notes and 4 cards made only from this file.",
          },
        ]}
      />
    </Section>
  );
}

function Statuses() {
  return (
    <Section title="Status and provenance">
      <div className={styles.wrap}>
        <ClassStatusChip status="readyToProcess" />
        <ClassStatusChip status="waitingForAllowance" />
        <ClassStatusChip status="inQueue" />
        <ClassStatusChip status="processing" />
        <ClassStatusChip status="needsAction" />
        <ClassStatusChip status="partlyReady" detail="Part 2 missing" />
        <ClassStatusChip status="ready" />
        <ClassStatusChip status="failed" />
        <ClassStatusChip status="cancelled" />
      </div>
      <div className={styles.stack}>
        <SourceStatus status="onThisDevice" />
        <SourceStatus status="sending" />
        <SourceStatus status="sent" />
        <SourceStatus status="serverCopyDeleted" />
        <SourceStatus status="notOnThisDevice" />
        <SourceStatus status="uploading" done={3} total={10} />
        <SourceStatus status="checking" />
        <SourceStatus status="received" />
        <SourceStatus status="notAccepted" reason="the page is empty" />
        <SourceStatus status="needsAction" action="upload a copy without a password" />
      </div>
      <div className={styles.wrap}>
        <ProvenanceLabel kind="class" />
        <ProvenanceLabel kind="ai" />
        <ProvenanceLabel kind="edited" detail="30 Sep" />
        <ExperimentalBadge />
      </div>
      <ProvenanceBlock kind="class">"I've already finished my homework."</ProvenanceBlock>
      <ProvenanceBlock kind="ai">
        We often put <em>already</em> between <em>have</em> and the verb.
      </ProvenanceBlock>
      <ProvenanceBlock kind="edited" detail="30 Sep">
        Already = earlier than I thought.
      </ProvenanceBlock>
      <div className={styles.wrap}>
        <SourceChip source={{ type: "audio", label: "Class audio · 18:42" }} />
        <SourceChip source={{ type: "audio", label: "18:42 – 19:05 · playing" }} playing />
        <SourceChip source={{ type: "page", label: "Worksheet · page 4" }} />
        <SourceChip source={{ type: "photo", label: "Board photo 2" }} />
        <SourceChip
          source={{ type: "audio", label: "Class audio · 18:42" }}
          availability="notOnDevice"
        />
        <SourceChip source={{ type: "page", label: "Worksheet · p.4" }} availability="notKept" />
      </div>
    </Section>
  );
}

function Feedback() {
  const [retries, setRetries] = useState(0);
  return (
    <Section title="Banners and states">
      <Banner tone="primary" icon={CircleHalf} title="Partly ready">
        Part 2 isn't ready yet. These notes use Part 1 and the worksheet only.
      </Banner>
      <Banner tone="warning" icon={Flask} title="Experimental quality">
        Arabic explanations may have mistakes. We show English next to them.
      </Banner>
      <Banner tone="info" icon={WifiSlash} title="You're offline">
        Recording still works. Other changes will wait until you're back online.
      </Banner>
      <Banner
        tone="neutral"
        icon={ArrowsClockwise}
        title="New sources since your notes were made"
        action={<Button variant="ghost">Update affected parts</Button>}
      />
      <Banner tone="info" icon={WifiSlash} layout="strip">
        You're offline. You can still record and recover recordings.
      </Banner>
      <InlineError
        title="Couldn't load your sessions"
        text="Check your connection and try again."
        onRetry={() => setRetries((n) => n + 1)}
      />
      <p className={styles.note}>
        Retries: <span data-testid="retries">{retries}</span>
      </p>
      <EmptyState
        icon={Cards}
        text="No cards yet. Cards appear after a session is processed."
        action={<Button icon={Plus}>New session</Button>}
      />
      <Skeleton
        label="Loading review"
        lines={[
          { width: "40%" },
          { width: "75%", height: 22 },
          { width: "100%", height: 52, radius: 14 },
        ]}
      />
      <HeroCard className={styles.hero}>
        <div className={styles.heroLabel}>
          <Icon icon={Cards} size={18} />
          Daily review
        </div>
        <div className={`rc-num ${styles.heroCount}`}>12 cards due · 5 new</div>
        <div className={styles.heroMuted}>About 15 min</div>
        <Button size="lg" block className={styles.onSurface}>
          Start review
        </Button>
      </HeroCard>
    </Section>
  );
}

function Overlays() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [snackbar, setSnackbar] = useState(false);
  const [result, setResult] = useState("none");
  return (
    <Section title="Sheets, dialogs and snackbar">
      <div className={styles.row}>
        <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
        <Button onClick={() => setDiscardOpen(true)}>Open discard confirm</Button>
        <Button onClick={() => setDeleteOpen(true)}>Open delete confirm</Button>
        <Button onClick={() => setSnackbar(true)}>Show snackbar</Button>
      </div>
      <p className={styles.note}>
        Result: <span data-testid="overlay-result">{result}</span>
      </p>
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="New session">
        <Field id="sheet-title" label="Title (optional)">
          {(control) => <TextInput {...control} placeholder="For example: Present perfect" />}
        </Field>
        <Button variant="primary" size="lg" block onClick={() => setSheetOpen(false)}>
          Create session
        </Button>
      </Sheet>
      <ConfirmDialog
        open={discardOpen}
        onClose={() => {
          setDiscardOpen(false);
          setResult("kept recording");
        }}
        onConfirm={() => {
          setDiscardOpen(false);
          setResult("discarded");
        }}
        title="Discard this recording?"
        consequences={[
          "1 h 12 min of audio will be deleted from this device.",
          "It was not sent anywhere, so you can't get it back.",
        ]}
        safeLabel="Keep recording"
        confirmLabel="Discard"
        requireAck
        safeIsPrimary
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setResult("kept class");
        }}
        onConfirm={() => {
          setDeleteOpen(false);
          setResult("deleted class");
        }}
        title="Delete this session?"
        consequences={[
          "Notes and 14 cards from this session will be deleted.",
          "The recording on this device will be deleted.",
          "Files you already downloaded can't be recalled.",
        ]}
        safeLabel="Keep session"
        confirmLabel="Delete session"
      />
      {snackbar ? (
        <Snackbar
          icon={PauseCircle}
          message="Card suspended"
          onUndo={() => {
            setSnackbar(false);
            setResult("undone");
          }}
          onDismiss={() => setSnackbar(false)}
        />
      ) : null}
    </Section>
  );
}

function Scripts() {
  return (
    <Section title="Scripts and direction">
      <ContentBlock reading dir="ltr" lang="en">
        <span data-testid="mixed">
          The word "apple" <Bdi lang="fa">یعنی سیب</Bdi>
          <span data-testid="mixed-end">.</span>
        </span>
      </ContentBlock>
      <ContentBlock reading lang="fa" className={styles.script}>
        <span data-testid="persian">
          already یعنی «قبلاً» یا «تا حالا»؛ وقتی کاری زودتر از انتظار انجام شده است.
        </span>
      </ContentBlock>
      <ContentBlock reading lang="ar" className={styles.script}>
        already تعني "بالفعل" أو "مسبقًا"، وتُستخدم عندما يحدث شيء أبكر من المتوقع.
      </ContentBlock>
      <ContentBlock reading lang="ru" className={styles.script}>
        already — «уже»: действие произошло раньше, чем ожидалось.
      </ContentBlock>
      <ContentBlock reading lang="ja" className={styles.script}>
        already は「もう」「すでに」という意味です。予想より早く起きたことを表します。
      </ContentBlock>
      <ContentBlock reading lang="zh-Hans" className={styles.script}>
        already 的意思是“已经”，表示事情比预期更早发生。
      </ContentBlock>
    </Section>
  );
}

export function UiKit() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>UI kit</h1>
      <p className={styles.note}>
        Development only. Every component in its states, for comparing with the design frames.
      </p>
      <ThemeSwitcher />
      <Buttons />
      <Fields />
      <Choices />
      <Statuses />
      <Feedback />
      <Overlays />
      <Scripts />
      <p className={styles.note}>
        <Icon icon={Image} /> Images and icons: Phosphor, local SVG.
      </p>
    </main>
  );
}
