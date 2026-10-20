// No "use client": these screens always sit inside a client component that saves the answer.
import type { ExplanationLanguage, Goal, Level } from "@recalino/core/acc";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { accountCopy } from "../../ui/account-copy";
import { Button } from "../../ui/components/Button";
import { Checkbox } from "../../ui/components/Checkbox";
import { Banner } from "../../ui/components/Feedback";
import { Icon } from "../../ui/components/Icon";
import { ListPicker, type PickerOption } from "../../ui/components/ListPicker";
import { RadioCards } from "../../ui/components/RadioCards";
import { courseCopy } from "../../ui/course-copy";
import {
  Buildings,
  Check,
  Flask,
  GlobeHemisphereWest,
  HandWaving,
  LockSimple,
  WarningCircle,
} from "../../ui/icons";
import { fill } from "../../ui/strings-fill";
import { setupStrings as strings } from "../../ui/strings-setup";
import { SaveError } from "./api";
import { GOAL_LABELS } from "./labels";
import {
  allTimeZones,
  browserTimeZone,
  type FirstLanguage,
  languageName,
  languageNames,
  timeZoneCity,
  timeZoneCountry,
  timeZoneNow,
} from "./languages";
import styles from "./setup.module.css";

// The screens of profile setup (frames A2.1 to A2.7). Settings reuses the same screens to edit
// one answer (FR-ACC-004), with `note` saying that existing notes stay as they are.

type StepProps<T> = {
  onSubmit: (value: T) => Promise<void>;
  /** Shown above the button when editing from Settings. */
  note?: ReactNode;
  mode?: "setup" | "edit";
  onCancel?: () => void;
};

/** Runs a save, shows its error, and keeps the button busy meanwhile. */
function useSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof SaveError ? failure : new SaveError(accountCopy.error.save));
      setSaving(false);
    }
  };
  return { saving, error, run };
}

function SaveFailed({ failure }: { failure: SaveError | null }) {
  const pathname = usePathname();
  return failure === null ? null : (
    <Banner
      tone="danger"
      icon={WarningCircle}
      role="alert"
      action={
        failure.status === 401 || failure.code === "unauthenticated" ? (
          <Link href={`/?next=${encodeURIComponent(pathname)}`} className="btn btn-secondary">
            {accountCopy.error.signIn}
          </Link>
        ) : undefined
      }
    >
      {failure.message}
    </Banner>
  );
}

function StepActions({
  mode,
  onCancel,
  saving,
  children,
}: {
  mode: "setup" | "edit";
  onCancel?: () => void;
  saving: boolean;
  children: ReactNode;
}) {
  return mode === "edit" ? (
    <div className={styles.pair}>
      <Button size="lg" className={styles.skip} disabled={saving} onClick={onCancel}>
        {accountCopy.cancel}
      </Button>
      {children}
    </div>
  ) : (
    children
  );
}

/** A2.1 — first language, with the Experimental note after choosing one (A2.1b). */
export function FirstLanguageStep({
  value,
  languages,
  onSubmit,
  note,
  mode = "setup",
  onCancel,
}: StepProps<string> & { value: string | null; languages: readonly FirstLanguage[] }) {
  const [chosen, setChosen] = useState(value);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const { saving, error, run } = useSave();
  const experimental = useMemo(
    () => new Set(languages.filter((item) => item.experimental).map((item) => item.code)),
    [languages],
  );

  // Names come from the browser, so the list is built after the page loads.
  useEffect(() => {
    setOptions(
      languageNames(languages.map((item) => item.code)).map((name) => ({
        id: name.code,
        search: `${name.english} ${name.native ?? ""} ${name.code}`.toLowerCase(),
        label: (
          <>
            {name.english}
            {name.native ? (
              <>
                {" — "}
                <bdi lang={name.code} dir="auto">
                  {name.native}
                </bdi>
              </>
            ) : null}
          </>
        ),
        badge: experimental.has(name.code) ? <Experimental /> : undefined,
      })),
    );
  }, [languages, experimental]);

  const chosenName = chosen ? languageName(chosen) : null;
  return (
    <div className={styles.step}>
      <h1 className={styles.title}>
        {mode === "edit" ? accountCopy.language.title : strings.setup.firstLanguage}
      </h1>
      {mode === "edit" ? (
        <>
          <p className={styles.help}>{accountCopy.language.help}</p>
          {value ? (
            <div className={styles.locked}>
              <div className={styles.lockedText}>
                <span className={styles.small}>{accountCopy.language.current}</span>
                <span>
                  {languageName(value).english}
                  {languageName(value).native ? (
                    <>
                      {" — "}
                      <bdi lang={value} dir="auto">
                        {languageName(value).native}
                      </bdi>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <ListPicker
        label={strings.setup.firstLanguage}
        placeholder={strings.setup.search}
        options={options}
        value={chosen}
        onChange={setChosen}
        emptyText={strings.setup.noLanguage}
      />
      {chosen && chosenName && experimental.has(chosen) ? (
        <Banner tone="warning" icon={Flask}>
          {fill(strings.setup.experimentalNote, { language: chosenName.english })}
        </Banner>
      ) : null}
      <div className={styles.grow} />
      {note}
      <SaveFailed failure={error} />
      <StepActions mode={mode} onCancel={onCancel} saving={saving}>
        <Button
          variant="primary"
          size="lg"
          block={mode === "setup"}
          className={mode === "edit" ? styles.go : undefined}
          unavailable={chosen === null}
          loading={saving}
          onClick={() => chosen && run(() => onSubmit(chosen))}
        >
          {saving
            ? accountCopy.saving
            : mode === "edit"
              ? accountCopy.save
              : strings.setup.continue}
        </Button>
      </StepActions>
    </div>
  );
}

function Experimental() {
  return (
    <span className={styles.experimental}>
      <Icon icon={Flask} />
      {strings.setup.experimental}
    </span>
  );
}

/** A2.2–3 — the fixed learning language and the explanation language (no default). */
export function ExplanationStep({
  firstLanguage,
  value,
  onSubmit,
  note,
  showLearning = true,
  mode = "setup",
  onCancel,
}: StepProps<ExplanationLanguage> & {
  firstLanguage: string;
  value: ExplanationLanguage | null;
  showLearning?: boolean;
}) {
  const [chosen, setChosen] = useState(value);
  const [name, setName] = useState<{ english: string; native: string | undefined } | null>(null);
  const reasonId = useId();
  const { saving, error, run } = useSave();
  useEffect(() => setName(languageName(firstLanguage)), [firstLanguage]);

  return (
    <div className={styles.step}>
      {showLearning ? (
        <div className={styles.locked}>
          <Icon icon={LockSimple} className={styles.muted} />
          <div className={styles.lockedText}>
            <span className={styles.small}>{strings.setup.youAreLearning}</span>
            <span>{strings.setup.english}</span>
          </div>
          <span className={styles.small}>{strings.setup.learningFixed}</span>
        </div>
      ) : null}
      <h1 className={`${styles.title} ${styles.titleSpaced}`}>
        {mode === "edit" ? accountCopy.explanations.title : strings.setup.explanationsIn}
      </h1>
      <p className={styles.help}>
        {mode === "edit" ? accountCopy.explanations.help : strings.setup.explanationsHelp}
      </p>
      <RadioCards
        name="explanation-language"
        label={strings.setup.explanationsIn}
        value={chosen}
        onChange={setChosen}
        options={[
          { value: "english", title: strings.setup.english },
          {
            value: "first_language",
            title: name?.native ?? name?.english ?? firstLanguage,
            lang: name?.native ? firstLanguage : undefined,
            meta: name?.native ? name.english : undefined,
          },
        ]}
      />
      <div className={styles.grow} />
      {note}
      <SaveFailed failure={error} />
      <StepActions mode={mode} onCancel={onCancel} saving={saving}>
        <Button
          variant="primary"
          size="lg"
          block={mode === "setup"}
          className={mode === "edit" ? styles.go : undefined}
          unavailable={chosen === null}
          loading={saving}
          aria-describedby={chosen === null ? reasonId : undefined}
          onClick={() => chosen && run(() => onSubmit(chosen))}
        >
          {saving
            ? accountCopy.saving
            : mode === "edit"
              ? accountCopy.save
              : strings.setup.continue}
        </Button>
      </StepActions>
      {chosen === null ? (
        <p id={reasonId} className={styles.center}>
          {strings.setup.chooseOne}
        </p>
      ) : null}
    </div>
  );
}

const LEVEL_OPTIONS: ReadonlyArray<{ value: Level; label: string }> = [
  { value: "A1", label: "A1" },
  { value: "A2", label: "A2" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
  { value: "C1", label: "C1" },
  { value: "C2", label: "C2" },
];

function Tile({
  name,
  value,
  checked,
  onChange,
  label,
  shape,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  shape: "square" | "wide" | "chip";
}) {
  return (
    <label className={`${styles.choice} ${styles[shape]}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className={`${styles.tileInput} rc-visually-hidden`}
      />
      {checked ? <Icon icon={Check} /> : null}
      {label}
    </label>
  );
}

/** A2.4–5 — level and goal, both optional, one choice each. */
export function LevelGoalStep({
  level,
  goal,
  onSubmit,
  note,
  mode = "setup",
  onCancel,
}: StepProps<{ level: Level | null; goal: Goal | null }> & {
  level: Level | null;
  goal: Goal | null;
}) {
  const [chosenLevel, setLevel] = useState(level);
  const [chosenGoal, setGoal] = useState(goal);
  const { saving, error, run } = useSave();
  return (
    <div className={`${styles.step} ${styles.stepTight}`}>
      <h1 className={styles.title}>
        {mode === "edit" ? accountCopy.levelGoal.title : strings.setup.level}
      </h1>
      <p className={styles.help}>
        {mode === "edit" ? accountCopy.levelGoal.help : strings.setup.levelHelp}
      </p>
      <div role="radiogroup" aria-label={strings.setup.level} className={styles.levels}>
        {LEVEL_OPTIONS.map((option) => (
          <Tile
            key={option.value}
            name="level"
            value={option.value}
            checked={chosenLevel === option.value}
            onChange={() => setLevel(option.value)}
            label={option.label}
            shape="square"
          />
        ))}
        <Tile
          name="level"
          value="not_sure"
          checked={chosenLevel === "not_sure"}
          onChange={() => setLevel("not_sure")}
          label={strings.setup.notSure}
          shape="wide"
        />
      </div>
      <h2 className={styles.subtitle}>{strings.setup.goal}</h2>
      {mode === "setup" ? <p className={styles.help}>{courseCopy.goalHelp}</p> : null}
      <div role="radiogroup" aria-label={strings.setup.goal} className={styles.goals}>
        {(Object.keys(GOAL_LABELS) as Goal[]).map((value) => (
          <Tile
            key={value}
            name="goal"
            value={value}
            checked={chosenGoal === value}
            onChange={() => setGoal(value)}
            label={GOAL_LABELS[value]}
            shape="chip"
          />
        ))}
      </div>
      <div className={styles.grow} />
      {note}
      <SaveFailed failure={error} />
      <div className={styles.pair}>
        {mode === "setup" ? (
          <Button
            size="lg"
            className={styles.skip}
            disabled={saving}
            onClick={() => run(() => onSubmit({ level: null, goal: null }))}
          >
            {strings.setup.skip}
          </Button>
        ) : (
          <Button size="lg" className={styles.skip} disabled={saving} onClick={onCancel}>
            {accountCopy.cancel}
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          className={styles.go}
          loading={saving}
          onClick={() => run(() => onSubmit({ level: chosenLevel, goal: chosenGoal }))}
        >
          {saving
            ? accountCopy.saving
            : mode === "edit"
              ? accountCopy.save
              : strings.setup.continue}
        </Button>
      </div>
    </div>
  );
}

/** A2.6 — the time zone from the browser; "Change time zone" opens a searchable list. */
export function TimezoneStep({
  value,
  onSubmit,
  note,
  mode = "setup",
  onCancel,
}: StepProps<string> & { value: string | null }) {
  const [zone, setZone] = useState(value);
  const [changing, setChanging] = useState(false);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [now, setNow] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const { saving, error, run } = useSave();

  useEffect(() => {
    setZone((current) => current ?? browserTimeZone());
  }, []);
  useEffect(() => {
    if (!zone) return;
    setNow(timeZoneNow(zone));
    setCountry(timeZoneCountry(zone));
  }, [zone]);
  useEffect(() => {
    if (!changing) return;
    setOptions(
      allTimeZones().map((id) => ({
        id,
        label: id.replaceAll("_", " "),
        search: id.toLowerCase().replaceAll("_", " "),
      })),
    );
  }, [changing]);

  return (
    <div className={styles.step}>
      <h1 className={styles.title}>
        {mode === "edit" ? accountCopy.timezone.title : strings.setup.timezone}
      </h1>
      <p className={styles.help}>
        {mode === "edit" ? accountCopy.timezone.help : strings.setup.timezoneHelp}
      </p>
      {zone ? (
        <div className={styles.zone}>
          <Icon icon={GlobeHemisphereWest} size={28} className={styles.accent} />
          <div className={styles.zoneText}>
            <span className={styles.zoneCity}>
              {country ? `${timeZoneCity(zone)} (${country})` : timeZoneCity(zone)}
            </span>
            <span className={`rc-num ${styles.small}`}>
              {now ? fill(strings.setup.timezoneNow, { zone, time: now }) : zone}
            </span>
          </div>
        </div>
      ) : null}
      {changing ? null : (
        <Button size="lg" block disabled={saving} onClick={() => setChanging(true)}>
          {strings.setup.timezoneChange}
        </Button>
      )}
      {changing ? (
        <ListPicker
          label={strings.setup.timezoneChange}
          placeholder={accountCopy.timezone.search}
          options={options}
          value={zone}
          onChange={(id) => {
            setZone(id);
            setChanging(false);
          }}
          emptyText={strings.setup.checkSpelling}
        />
      ) : null}
      <div className={styles.grow} />
      {note}
      <SaveFailed failure={error} />
      <StepActions mode={mode} onCancel={onCancel} saving={saving}>
        <Button
          variant="primary"
          size="lg"
          block={mode === "setup"}
          className={mode === "edit" ? styles.go : undefined}
          unavailable={zone === null}
          loading={saving}
          onClick={() => zone && run(() => onSubmit(zone))}
        >
          {saving
            ? accountCopy.saving
            : mode === "edit"
              ? accountCopy.save
              : strings.setup.timezoneYes}
        </Button>
      </StepActions>
    </div>
  );
}

const POINTS = [
  { icon: HandWaving, title: strings.setup.askFirst, text: strings.setup.askFirstText },
  { icon: Buildings, title: strings.setup.collegeRules, text: strings.setup.collegeRulesText },
  { icon: LockSimple, title: strings.setup.studyOnly, text: strings.setup.studyOnlyText },
] as const;

/** A2.7 — recording consent, asked once (D33). Finish stays unavailable until ticked. */
export function ConsentStep({
  onSubmit,
  note,
  actionLabel = strings.setup.finish,
  headingLevel = 1,
}: StepProps<true> & { actionLabel?: string; headingLevel?: 1 | 2 }) {
  const [understood, setUnderstood] = useState(false);
  const [ready, setReady] = useState(false);
  // Native inputs can change before React attaches its controlled change handler.
  // Keep consent disabled in the server HTML until that handler is ready.
  useEffect(() => setReady(true), []);
  const reasonId = useId();
  const { saving, error, run } = useSave();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const PointHeading = headingLevel === 1 ? "h2" : "h3";
  return (
    <div className={styles.consent}>
      <div className={styles.step}>
        <div className={styles.consentHead}>
          <Heading className={styles.title}>{strings.setup.consentTitle}</Heading>
          <p className={styles.help}>{strings.setup.consentIntro}</p>
        </div>
        {POINTS.map((point) => (
          <div key={point.title} className={styles.point}>
            <div className={styles.pointIcon}>
              <Icon icon={point.icon} size={22} />
            </div>
            <div className={styles.pointText}>
              <PointHeading className={styles.pointTitle}>{point.title}</PointHeading>
              <p className={styles.help}>{point.text}</p>
            </div>
          </div>
        ))}
        <p className={styles.note}>{strings.setup.askedOnce}</p>
        {note}
      </div>
      <div className={styles.consentBar}>
        <Checkbox
          label={strings.setup.consentBox}
          labelId={reasonId}
          checked={understood}
          disabled={!ready || saving}
          onChange={(event) => setUnderstood(event.target.checked)}
        />
        <SaveFailed failure={error} />
        <Button
          variant="primary"
          size="lg"
          block
          unavailable={!ready || !understood}
          loading={saving}
          aria-describedby={understood ? undefined : reasonId}
          onClick={() => understood && run(() => onSubmit(true))}
        >
          {saving ? accountCopy.saving : actionLabel}
        </Button>
      </div>
    </div>
  );
}
