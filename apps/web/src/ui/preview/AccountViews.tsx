"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";
import { LEGAL_TEXTS } from "../../legal/texts.generated";
import { accountCopy } from "../account-copy";
import { Checkbox } from "../components/Checkbox";
import { LegalDocument } from "../components/LegalDocument";
import { ListPicker, type PickerOption } from "../components/ListPicker";
import { RadioCards } from "../components/RadioCards";
import { ConfirmDialog } from "../components/Sheet";
import { courseCopy } from "../course-copy";
import { retryAllowanceCopy } from "../retry-allowance-copy";
import { strings } from "../strings";
import styles from "./AccountViews.module.css";
import { type PreviewState, usePreview } from "./PreviewContext";
import { Actions, Button, LinkButton, PageHeader, Panel, Status } from "./primitives";

const copy = {
  profile: "Your learning settings",
  profileHelp: "Make Recalino work for the way you learn.",
  learning: "Your learning profile",
  space: "Your learning space",
  account: "Account",
  language: "First language",
  explanations: "Explanations",
  level: "Level and goal",
  timezone: "Time zone",
  progress: "Progress",
  preferences: "Preferences",
  allowance: "Processing allowance",
  data: "Your data",
  signOut: "Sign out",
  preferencesTitle: "How you like to learn",
  preferencesHelp: "Keep your choices separate from suggestions based on practice.",
  ownChoices: "Your choices",
  mode: "Review mode",
  simple: "Simple",
  simpleHelp: "Two clear choices: forgot or remembered.",
  advanced: "Advanced",
  advancedHelp: "Four choices: again, hard, good or easy.",
  newCards: "Include new cards in daily review",
  shortExamples: "Use shorter examples",
  suggestions: "Suggested preferences",
  suggestionHelp: "A sample suggestion based on practice. You decide whether to use it.",
  shorter: "Try shorter examples",
  acceptSuggestion: "Accept suggestion",
  dismissSuggestion: "Dismiss suggestion",
  resetSuggestions: "Reset suggestions",
  resetHelp: "Your saved choices stay the same.",
  savePreferences: "Save preferences",
  allowanceTitle: "Your processing allowance",
  allowanceHelp: "Use it for the session material that helps you most.",
  available: "Available in this sample",
  minutes: "audio minutes remaining",
  pages: "pages/photos remaining",
  separate: "Audio and pages/photos have separate allowances.",
  use: "Recent use",
  noUse: "No sample processing yet. Your allowance is available when you are ready.",
  useHelp: `The available amounts reflect processing in this sample workspace. ${retryAllowanceCopy()}`,
  noAllowance: "No allowance left?",
  operatorHelp:
    "Keep your session material for later and ask the pilot operator about your allowance.",
  ask: "Ask pilot operator",
  english: "English only",
  englishHelp: "Words and grammar explained in English.",
  native: "First-language explanations",
  nativeHelp: "Explanations in your first language. Class words and examples stay in English.",
  optional: "Not set",
  chooseLevel: "Your level",
  levelHelp: "Choose the closest fit.",
  chooseGoal: "Your goal",
  goalHelp: "What are you learning English for?",
  notSure: "Not sure",
  setupExplanationTitle: "How would you like explanations?",
  setupExplanationHelp: "Step 2 of 5 · Session notes stay in English.",
  setupGoalTitle: "Your English, your goal",
  setupGoalHelp: "Step 3 of 5 · Both choices are optional.",
  setupZoneTitle: "Make room for a little practice",
  setupZoneHelp: "Step 4 of 5 · Your time zone sets the review day.",
  continue: "Continue",
  skip: "Skip for now",
  back: "Back",
  currentZone: "Current time zone",
  chooseZone: "Choose a time zone",
  localTime: "Local time",
  rhythm: "Your daily rhythm",
  rhythmHelp: "Review whenever it suits you. This does not set a reminder.",
  rhythmHistory: "Your earlier reviews stay in your history.",
  searchLanguage: "Search by English or native name",
  noLanguages: "No language matches. Try another name.",
  noZones: "No time zone matches. Try another city.",
  experimental: "Experimental",
  experimentalHelp:
    "First-language explanations are experimental. They appear beside English so you can compare them. Check important points against your session material.",
  legalHelp: "Read the current documents, with clear navigation and a reachable close control.",
  legalSample:
    "The original development draft is shown below. The operator name and email in this preview are fictional.",
  legalAccepted: "Current documents accepted in this sample. No acceptance was sent to a server.",
  documents: "Choose a document",
  version: "Version",
  recordingVersion: "Current recording guidance · Version 0.1",
  dataHelp: "Choose exactly what to remove. Read the consequences first.",
  sourceTitle: "A source used in more than one session",
  sourceSample: "Shared handout.pdf · Used by 2 sample sessions",
  remove: "Remove from this session",
  removeHelp: "Disconnect it from this session. Keep the original source and its other use.",
  original: "Delete original, keep notes",
  originalHelp: "Remove the original file. Keep the notes and cards already made from it.",
  completely: "Delete completely",
  completeHelp: "Remove the source and its derived notes and cards from every connected session.",
  reviewSource: "Review source deletion",
  deleteAccount: "Delete your account",
  accountConsequence:
    "This resets the sample account, sessions and review history in this preview.",
  acknowledge: "I understand the sample changes will be removed.",
  keep: "Keep my data",
  reviewDeletion: "Review deletion",
  confirmAccount: "Reset this sample workspace?",
  confirmSource: "Remove this sample source?",
  confirmDelete: "Confirm deletion",
  deleteSource: "Delete source",
  resetResult: "Sample changes reset. No real account was deleted.",
} as const;

const LANGUAGES = [
  { id: "English", code: "en", native: "English" },
  { id: "Persian", code: "fa", native: "فارسی" },
  { id: "Arabic", code: "ar", native: "العربية" },
  { id: "Japanese", code: "ja", native: "日本語" },
  { id: "Spanish", code: "es", native: "Español" },
  { id: "Russian", code: "ru", native: "Русский" },
] as const;
const languageInfo = (value: string) =>
  LANGUAGES.find((item) => item.id === value || item.code === value);
const GOALS = ["ESOL study", "Everyday English", "Work", "IELTS", "Not sure"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", copy.notSure];
type ExplanationChoice = Exclude<PreviewState["profile"]["explanations"], "bilingual">;
const explanationChoice = (value: PreviewState["profile"]["explanations"]): ExplanationChoice =>
  value === "english" ? "english" : "native";

function LanguageName({ value }: { value: string }) {
  const language = languageInfo(value);
  return language ? (
    <>
      {language.id}
      {language.native !== language.id ? (
        <>
          {" "}
          —{" "}
          <bdi lang={language.code} dir="auto">
            {language.native}
          </bdi>
        </>
      ) : null}
    </>
  ) : (
    <bdi dir="auto">{value}</bdi>
  );
}

function ProfileView() {
  const { state, announce } = usePreview();
  const profile = state.profile;
  const rows = [
    { label: copy.language, value: <LanguageName value={profile.language} />, to: "edit-language" },
    {
      label: copy.explanations,
      value:
        explanationChoice(profile.explanations) === "english" ? (
          "English"
        ) : (
          <LanguageName value={profile.language} />
        ),
      to: "edit-explanations",
    },
    {
      label: copy.level,
      value: `${profile.level || copy.optional} / ${profile.goal || copy.optional}`,
      to: "edit-goal",
    },
    { label: copy.timezone, value: profile.timezone.replaceAll("_", " "), to: "edit-timezone" },
  ];
  return (
    <>
      <PageHeader title={copy.profile} description={copy.profileHelp} />
      <Panel title={copy.learning}>
        <p className="preview-muted">{courseCopy.goalHelp}</p>
        <div className={styles.rows}>
          {rows.map((row) => (
            <Link key={row.to} href={`/preview/${row.to}`} className={styles.row}>
              <span>
                <span className={styles.rowLabel}>{row.label}</span>
                <span className={styles.rowValue}>{row.value}</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </Panel>
      <Panel title={copy.space}>
        <div className={styles.rows}>
          {[
            { label: "Courses and sessions", to: "classes" },
            { label: copy.progress, to: "progress" },
            { label: copy.preferences, to: "preferences" },
            { label: copy.allowance, to: "allowance" },
            { label: copy.data, to: "data-controls" },
          ].map((item) => (
            <Link key={item.to} className={styles.row} href={`/preview/${item.to}`}>
              <span>{item.label}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </Panel>
      <Panel title={copy.account}>
        <div className={styles.rows}>
          <Link className={styles.row} href="/preview/legal">
            {accountCopy.legal.title}
            <span aria-hidden="true">→</span>
          </Link>
          <button
            type="button"
            className={styles.row}
            onClick={() =>
              announce(
                "Sign-out demonstration complete. This preview has no authenticated account.",
              )
            }
          >
            {copy.signOut}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </Panel>
    </>
  );
}

function PreferencesView() {
  const { state, setState, announce } = usePreview();
  const [draft, setDraft] = useState(state.preferences);
  const [suggestion, setSuggestion] = useState(true);
  const router = useRouter();
  useEffect(() => setDraft(state.preferences), [state.preferences]);
  return (
    <>
      <PageHeader title={copy.preferencesTitle} description={copy.preferencesHelp} back="profile" />
      <Panel title={copy.ownChoices}>
        <RadioCards
          name="sample-review-mode"
          label={copy.mode}
          value={draft.ratingMode}
          onChange={(ratingMode) => setDraft({ ...draft, ratingMode })}
          options={[
            { value: "simple", title: copy.simple, description: copy.simpleHelp },
            { value: "advanced", title: copy.advanced, description: copy.advancedHelp },
          ]}
        />
        <div className={styles.checks}>
          <Checkbox
            label={copy.newCards}
            checked={draft.newCards}
            onChange={(event) => setDraft({ ...draft, newCards: event.target.checked })}
          />
          <Checkbox
            label={copy.shortExamples}
            checked={draft.shortExamples}
            onChange={(event) => setDraft({ ...draft, shortExamples: event.target.checked })}
          />
        </div>
      </Panel>
      <Panel title={copy.suggestions}>
        <p>{copy.suggestionHelp}</p>
        {suggestion ? (
          <>
            <h3>{copy.shorter}</h3>
            <Actions>
              <Button
                onClick={() => {
                  setDraft({ ...draft, shortExamples: true });
                  setSuggestion(false);
                  announce("Suggestion added to your choices. Save preferences to keep it.");
                }}
              >
                {copy.acceptSuggestion}
              </Button>
              <Button
                secondary
                onClick={() => {
                  setSuggestion(false);
                  announce("Suggestion dismissed. Your choices stay the same.");
                }}
              >
                {copy.dismissSuggestion}
              </Button>
            </Actions>
          </>
        ) : (
          <Status>Suggestion reviewed.</Status>
        )}
        <div className={styles.reset}>
          <p className={styles.muted}>{copy.resetHelp}</p>
          <Button
            secondary
            onClick={() => {
              setSuggestion(true);
              announce("Sample suggestions reset. Your choices stay the same.");
            }}
          >
            {copy.resetSuggestions}
          </Button>
        </div>
      </Panel>
      <Actions>
        <Button
          onClick={() => {
            setState((current) => ({ ...current, preferences: draft }));
            announce("Preferences saved in this sample.");
            router.push("/preview/profile");
          }}
        >
          {copy.savePreferences}
        </Button>
        <LinkButton to="profile" secondary>
          {accountCopy.cancel}
        </LinkButton>
      </Actions>
    </>
  );
}

function AllowanceView() {
  const { state, announce } = usePreview();
  return (
    <>
      <PageHeader title={copy.allowanceTitle} description={copy.allowanceHelp} back="profile" />
      <Panel title={copy.available} tone="hero">
        <div className={styles.allowance}>
          <div>
            <strong>{state.allowance.minutes}</strong>
            <span>{copy.minutes}</span>
          </div>
          <div>
            <strong>{state.allowance.pages}</strong>
            <span>{copy.pages}</span>
          </div>
        </div>
        <p>{copy.separate}</p>
      </Panel>
      <Panel title={copy.use}>
        <p>{state.processing === "idle" ? copy.noUse : copy.useHelp}</p>
      </Panel>
      <Panel title={copy.noAllowance}>
        <p>{copy.operatorHelp}</p>
        <Button
          secondary
          onClick={() =>
            announce("Operator contact is a demonstration. No message was sent from this preview.")
          }
        >
          {copy.ask}
        </Button>
      </Panel>
      <Actions>
        <LinkButton to="classes">View courses</LinkButton>
        <LinkButton to="profile" secondary>
          {accountCopy.back}
        </LinkButton>
      </Actions>
    </>
  );
}

function LanguageEditor() {
  const { state, setState, announce } = usePreview();
  const router = useRouter();
  const [value, setValue] = useState(
    languageInfo(state.profile.language)?.id ?? state.profile.language,
  );
  useEffect(() => {
    setValue(languageInfo(state.profile.language)?.id ?? state.profile.language);
  }, [state.profile.language]);
  const options: PickerOption[] = LANGUAGES.map((language) => ({
    id: language.id,
    search: `${language.id} ${language.native} ${language.code}`.toLowerCase(),
    label: <LanguageName value={language.id} />,
    badge:
      language.code !== "en" ? (
        <span className={styles.badge}>{copy.experimental}</span>
      ) : undefined,
  }));
  return (
    <>
      <PageHeader
        title={accountCopy.language.title}
        description={accountCopy.language.help}
        back="profile"
      />
      <Panel title={accountCopy.language.current}>
        <LanguageName value={state.profile.language} />
      </Panel>
      <Panel>
        <ListPicker
          label="Search languages"
          placeholder={copy.searchLanguage}
          options={options}
          value={value}
          onChange={setValue}
          emptyText={copy.noLanguages}
        />
        {value !== "English" ? <p className={styles.muted}>{copy.experimentalHelp}</p> : null}
      </Panel>
      <Status>{accountCopy.learningImpact}</Status>
      <Actions>
        <Button
          onClick={() => {
            setState((current) => ({
              ...current,
              profile: { ...current.profile, language: value },
            }));
            announce("First language saved in this sample.");
            router.push("/preview/profile");
          }}
        >
          {accountCopy.save}
        </Button>
        <LinkButton to="profile" secondary>
          {accountCopy.cancel}
        </LinkButton>
      </Actions>
    </>
  );
}

function ExplanationEditor({ setup = false }: { setup?: boolean }) {
  const { state, setState, announce } = usePreview();
  const [value, setValue] = useState<ExplanationChoice | null>(
    setup ? null : explanationChoice(state.profile.explanations),
  );
  const router = useRouter();
  const language = languageInfo(state.profile.language);
  useEffect(() => {
    if (!setup) setValue(explanationChoice(state.profile.explanations));
  }, [setup, state.profile.explanations]);
  const options = [
    { value: "english" as const, title: copy.english, description: copy.englishHelp },
    {
      value: "native" as const,
      title: language?.native ?? state.profile.language,
      lang: language?.code,
      meta:
        language?.code === "en"
          ? language.id
          : `${language?.id ?? state.profile.language} · ${copy.experimental}`,
      description: copy.nativeHelp,
    },
  ];
  return (
    <>
      <PageHeader
        title={setup ? copy.setupExplanationTitle : accountCopy.explanations.title}
        description={setup ? copy.setupExplanationHelp : accountCopy.explanations.help}
        back={setup ? "edit-language" : "profile"}
      />
      <Panel title="Choose a language">
        <RadioCards
          name="sample-explanations"
          label={accountCopy.explanations.title}
          value={value}
          onChange={setValue}
          options={options}
        />
        {language?.code !== "en" ? (
          <p className={styles.sampleNotice}>{copy.experimentalHelp}</p>
        ) : null}
        {value === null ? <p className={styles.muted}>{strings.setup.chooseOne}</p> : null}
      </Panel>
      {setup ? null : <Status>{accountCopy.learningImpact}</Status>}
      <Actions>
        <Button
          disabled={value === null}
          onClick={() => {
            if (!value) return;
            setState((current) => ({
              ...current,
              profile: { ...current.profile, explanations: value },
            }));
            announce("Explanation language saved in this sample.");
            router.push(setup ? "/preview/setup-goal" : "/preview/profile");
          }}
        >
          {setup ? copy.continue : accountCopy.save}
        </Button>
        <LinkButton to={setup ? "edit-language" : "profile"} secondary>
          {setup ? copy.back : accountCopy.cancel}
        </LinkButton>
      </Actions>
    </>
  );
}

function GoalEditor({ setup = false }: { setup?: boolean }) {
  const { state, setState, announce } = usePreview();
  const [level, setLevel] = useState(setup ? "" : state.profile.level);
  const [goal, setGoal] = useState(setup ? "" : state.profile.goal);
  const router = useRouter();
  useEffect(() => {
    if (!setup) {
      setLevel(state.profile.level);
      setGoal(state.profile.goal);
    }
  }, [setup, state.profile.level, state.profile.goal]);
  const save = (nextLevel: string, nextGoal: string) => {
    setState((current) => ({
      ...current,
      profile: { ...current.profile, level: nextLevel, goal: nextGoal },
    }));
    announce("Level and goal saved in this sample.");
    router.push(setup ? "/preview/setup-timezone" : "/preview/profile");
  };
  return (
    <>
      <PageHeader
        title={setup ? copy.setupGoalTitle : accountCopy.levelGoal.title}
        description={setup ? copy.setupGoalHelp : accountCopy.levelGoal.help}
        back={setup ? "setup-explanations" : "profile"}
      />
      <Panel title={copy.chooseLevel}>
        <p>{copy.levelHelp}</p>
        <fieldset className={styles.tiles}>
          <legend className="rc-visually-hidden">{copy.chooseLevel}</legend>
          {LEVELS.map((choice) => (
            <label key={choice} className={styles.tile}>
              <input
                type="radio"
                name="sample-level"
                checked={level === choice}
                onChange={() => setLevel(choice)}
              />
              {choice}
            </label>
          ))}
        </fieldset>
      </Panel>
      <Panel title={copy.chooseGoal}>
        <p>{copy.goalHelp}</p>
        <p className="preview-muted">{courseCopy.goalHelp}</p>
        <RadioCards
          name="sample-goal"
          label={copy.chooseGoal}
          value={goal || null}
          onChange={setGoal}
          options={GOALS.map((choice) => ({ value: choice, title: choice }))}
        />
      </Panel>
      <Actions>
        <Button onClick={() => save(level, goal)}>
          {setup ? copy.continue : accountCopy.save}
        </Button>
        {setup ? (
          <Button secondary onClick={() => save("", "")}>
            {copy.skip}
          </Button>
        ) : null}
        <LinkButton to={setup ? "setup-explanations" : "profile"} secondary>
          {setup ? copy.back : accountCopy.cancel}
        </LinkButton>
      </Actions>
    </>
  );
}

function TimezoneEditor({ setup = false }: { setup?: boolean }) {
  const { state, setState, announce } = usePreview();
  const [zone, setZone] = useState(state.profile.timezone);
  const [zones, setZones] = useState<string[]>(["Europe/London", "Asia/Tehran", "Asia/Tokyo"]);
  const [time, setTime] = useState("");
  const router = useRouter();
  useEffect(() => setZone(state.profile.timezone), [state.profile.timezone]);
  useEffect(() => {
    setZones([...new Set([state.profile.timezone, ...Intl.supportedValuesOf("timeZone")])]);
  }, [state.profile.timezone]);
  useEffect(() => {
    setTime(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
    );
  }, [zone]);
  return (
    <>
      <PageHeader
        title={setup ? copy.setupZoneTitle : accountCopy.timezone.title}
        description={setup ? copy.setupZoneHelp : accountCopy.timezone.help}
        back={setup ? "setup-goal" : "profile"}
      />
      <Panel title={copy.currentZone}>
        <strong>{zone.replaceAll("_", " ")}</strong>
        {time ? (
          <p className={styles.muted}>
            {copy.localTime} · {time}
          </p>
        ) : null}
      </Panel>
      <Panel>
        <ListPicker
          label={copy.chooseZone}
          placeholder={accountCopy.timezone.search}
          options={zones.map((id) => ({
            id,
            label: id.replaceAll("_", " "),
            search: id.toLowerCase().replaceAll("_", " "),
          }))}
          value={zone}
          onChange={setZone}
          emptyText={copy.noZones}
        />
      </Panel>
      {setup ? (
        <Panel title={copy.rhythm}>
          <p>{copy.rhythmHelp}</p>
          <p className={styles.muted}>{copy.rhythmHistory}</p>
        </Panel>
      ) : null}
      <Actions>
        <Button
          onClick={() => {
            setState((current) => ({
              ...current,
              profile: { ...current.profile, timezone: zone },
            }));
            announce("Time zone saved in this sample.");
            router.push(setup ? "/preview/renew-consent" : "/preview/profile");
          }}
        >
          {setup ? copy.continue : accountCopy.save}
        </Button>
        <LinkButton to={setup ? "setup-goal" : "profile"} secondary>
          {setup ? copy.back : accountCopy.cancel}
        </LinkButton>
      </Actions>
    </>
  );
}

function ConsentView() {
  const { setState, announce } = usePreview();
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  return (
    <>
      <PageHeader
        title={accountCopy.renewedConsent.title}
        description={accountCopy.renewedConsent.description}
        back="profile"
      />
      <Panel title={strings.setup.consentTitle}>
        <p>{strings.setup.consentIntro}</p>
        <div className={styles.guidance}>
          {[
            { title: strings.setup.askFirst, text: strings.setup.askFirstText },
            { title: strings.setup.collegeRules, text: strings.setup.collegeRulesText },
            { title: strings.setup.studyOnly, text: strings.setup.studyOnlyText },
          ].map((point) => (
            <div key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </div>
          ))}
        </div>
        <p className={styles.muted}>{strings.setup.askedOnce}</p>
        <p className={styles.muted}>{copy.recordingVersion}</p>
      </Panel>
      <Panel>
        <Checkbox
          label={strings.setup.consentBox}
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <Actions>
          <Button
            disabled={!accepted}
            onClick={() => {
              setState((current) => ({
                ...current,
                profile: { ...current.profile, consent: true },
              }));
              announce(
                "Recording guidance accepted in this sample. No consent was sent to a server.",
              );
              router.push("/preview/today");
            }}
          >
            {accountCopy.accept}
          </Button>
        </Actions>
      </Panel>
    </>
  );
}

function LegalView() {
  const [document, setDocument] = useState<"terms" | "privacy">("terms");
  const [accepted, setAccepted] = useState(false);
  const [saved, setSaved] = useState(false);
  const { announce } = usePreview();
  const legal = LEGAL_TEXTS[document];
  const titleId = useId();
  return (
    <>
      <PageHeader title={accountCopy.legal.title} description={copy.legalHelp} back="profile" />
      <div className={styles.reader}>
        <header className={styles.readerHeader}>
          <fieldset aria-label={copy.documents} className={styles.documentTabs}>
            <Button
              secondary={document !== "terms"}
              aria-pressed={document === "terms"}
              onClick={() => setDocument("terms")}
            >
              {strings.signIn.terms}
            </Button>
            <Button
              secondary={document !== "privacy"}
              aria-pressed={document === "privacy"}
              onClick={() => setDocument("privacy")}
            >
              {strings.signIn.privacy}
            </Button>
          </fieldset>
          <p className={styles.muted}>
            {copy.version} {legal.version}
          </p>
        </header>
        <section
          className={styles.readerBody}
          aria-labelledby={titleId}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a named scroll region needs a tab stop for keyboard reading.
          tabIndex={0}
        >
          {/* A11Y-04: the document's own headings start at level 3 (they sit in a sheet in the app),
              so the page needs its level 2 here; it names the region and is not drawn. */}
          <h2 id={titleId} className="rc-visually-hidden">
            {document === "terms" ? strings.signIn.terms : strings.signIn.privacy}
          </h2>
          <p className={styles.sampleNotice}>{copy.legalSample}</p>
          <LegalDocument
            id={document}
            values={{
              operator_name: "Preview Operator (fictional)",
              operator_email: "preview@example.invalid",
            }}
          />
        </section>
        <footer className={styles.readerFooter}>
          <Checkbox
            label={strings.signIn.accept
              .replace("{terms}", strings.signIn.terms)
              .replace("{privacy}", strings.signIn.privacy)}
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <Actions>
            <Button
              disabled={!accepted || saved}
              onClick={() => {
                setSaved(true);
                announce(copy.legalAccepted);
              }}
            >
              {accountCopy.accept}
            </Button>
            <LinkButton to="profile" secondary>
              {strings.common.close}
            </LinkButton>
          </Actions>
          {saved ? <Status tone="success">{copy.legalAccepted}</Status> : null}
        </footer>
      </div>
    </>
  );
}

function DataControlsView() {
  const { reset, announce } = usePreview();
  const [choice, setChoice] = useState<"remove" | "original" | "complete" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState<"source" | "account" | null>(null);
  const [result, setResult] = useState("");
  const options = [
    { value: "remove" as const, title: copy.remove, description: copy.removeHelp },
    { value: "original" as const, title: copy.original, description: copy.originalHelp },
    { value: "complete" as const, title: copy.completely, description: copy.completeHelp },
  ];
  const selected = options.find((option) => option.value === choice);
  return (
    <>
      <PageHeader title={copy.data} description={copy.dataHelp} back="profile" />
      <Panel title={copy.sourceTitle}>
        <p>{copy.sourceSample}</p>
        <RadioCards
          name="sample-deletion-scope"
          label={copy.sourceTitle}
          value={choice}
          onChange={setChoice}
          options={options}
        />
        <Actions>
          <Button secondary disabled={!choice} onClick={() => setConfirmation("source")}>
            {copy.reviewSource}
          </Button>
        </Actions>
        {result ? <Status tone="success">{result}</Status> : null}
      </Panel>
      <Panel title={copy.deleteAccount}>
        <p>{copy.accountConsequence}</p>
        <Checkbox
          label={copy.acknowledge}
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <Actions>
          <LinkButton to="profile" secondary>
            {copy.keep}
          </LinkButton>
          <Button
            className={styles.danger}
            disabled={!acknowledged}
            onClick={() => setConfirmation("account")}
          >
            {copy.reviewDeletion}
          </Button>
        </Actions>
      </Panel>
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        title={confirmation === "account" ? copy.confirmAccount : copy.confirmSource}
        consequences={
          confirmation === "account"
            ? [copy.accountConsequence, "No real account or uploaded material is affected."]
            : [
                selected?.title ?? "",
                selected?.description ?? "",
                "This demonstrates deletion choices using sample data only.",
              ]
        }
        safeLabel={copy.keep}
        confirmLabel={confirmation === "account" ? copy.confirmDelete : copy.deleteSource}
        onConfirm={() => {
          if (confirmation === "account") {
            reset();
            setAcknowledged(false);
            setResult("");
            announce(copy.resetResult);
          } else {
            const message = `${selected?.title ?? "Deletion"} demonstrated. No real source was deleted.`;
            setResult(message);
            announce(message);
          }
          setConfirmation(null);
        }}
      />
    </>
  );
}

export function AccountViews({ screen }: { screen: string }) {
  let content: ReactNode;
  switch (screen) {
    case "preferences":
      content = <PreferencesView />;
      break;
    case "allowance":
      content = <AllowanceView />;
      break;
    case "profile":
      content = <ProfileView />;
      break;
    case "edit-language":
      content = <LanguageEditor />;
      break;
    case "edit-explanations":
      content = <ExplanationEditor />;
      break;
    case "edit-goal":
      content = <GoalEditor />;
      break;
    case "edit-timezone":
      content = <TimezoneEditor />;
      break;
    case "renew-consent":
      content = <ConsentView />;
      break;
    case "legal":
      content = <LegalView />;
      break;
    case "data-controls":
      content = <DataControlsView />;
      break;
    case "setup-explanations":
      content = <ExplanationEditor setup />;
      break;
    case "setup-goal":
      content = <GoalEditor setup />;
      break;
    case "setup-timezone":
      content = <TimezoneEditor setup />;
      break;
    default:
      content = <ProfileView />;
  }
  return <div className={styles.page}>{content}</div>;
}
