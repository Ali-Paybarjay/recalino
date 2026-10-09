"use client";
import type { LearningOverview, MemoryItem, SimplerRequest } from "@recalino/core/pers";
import { useRef } from "react";
import { learningMemoryCopy as copy } from "./learning-memory-copy";
import { Actions, Button, LinkButton, Panel } from "./primitives";

type Memory = LearningOverview["memory"];

/** Dates follow the learner's saved time zone, so server and browser render the same text. */
export function memoryDate(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

function classDate(value: string): string {
  return memoryDate(`${value}T12:00:00Z`, "UTC");
}

function sets(item: MemoryItem): string {
  return item.evidence.studySets
    .map((set) =>
      set === "production"
        ? copy.setProduction
        : set === "recognition"
          ? copy.setRecognition
          : copy.setLegacy,
    )
    .join(", ");
}

export function NextStepPanel({ memory, timeZone }: { memory: Memory; timeZone: string }) {
  const step = memory.nextStep;
  return (
    <Panel title={copy.nextTitle}>
      {step.kind === "practise_item" ? (
        <>
          <p>{step.due ? copy.nextPractiseDue(step.label) : copy.nextPractiseCard(step.label)}</p>
          <Actions>
            <LinkButton href={step.href}>
              {step.due ? copy.nextPractiseDueAction : copy.nextPractiseCardAction}
            </LinkButton>
          </Actions>
        </>
      ) : step.kind === "review_due" ? (
        <>
          <p>{copy.nextReviewDue(step.count)}</p>
          <Actions>
            <LinkButton href={step.href}>{copy.nextReviewDueAction}</LinkButton>
          </Actions>
        </>
      ) : step.kind === "nothing_due" ? (
        <p>
          {copy.nextNothingDue}
          {step.nextDueAt ? ` ${copy.nextDueAt(memoryDate(step.nextDueAt, timeZone))}` : ""}
        </p>
      ) : (
        <>
          <p>{copy.nextNoCards}</p>
          <Actions>
            <LinkButton href={step.href}>{copy.nextNoCardsAction}</LinkButton>
          </Actions>
        </>
      )}
    </Panel>
  );
}

type GoalContext = Pick<
  SimplerRequest,
  "label" | "meaning" | "explanationLanguage" | "classDate" | "courseName"
>;

function Goal({ item }: { item: GoalContext }) {
  return (
    <>
      <h4 lang="en" dir="auto">
        {item.label}
      </h4>
      {item.meaning ? (
        <p lang={item.explanationLanguage ?? undefined} dir="auto">
          {item.meaning}
        </p>
      ) : null}
      {item.classDate ? (
        <p className="preview-muted">
          {copy.fromClass(classDate(item.classDate), item.courseName)}
        </p>
      ) : null}
    </>
  );
}

export function LearningMemoryPanel({
  memory,
  timeZone,
  busy,
  onFeedback,
  teachingMemory = false,
}: {
  memory: Memory;
  timeZone: string;
  busy: boolean;
  /** D49 release switch: simpler-explanation requests are offered only while they can apply. */
  teachingMemory?: boolean;
  onFeedback: (
    body: {
      learningItemId: string;
      kind: "not_a_difficulty" | "explain_simpler";
      active: boolean;
      shownLastAgainAt?: string | null;
    },
    key: string,
  ) => Promise<boolean>;
}) {
  // A retry after a failed or lost response reuses its key, so it cannot apply twice. A saved
  // correction drops its key: making the same correction again later is a new correction.
  const keys = useRef(new Map<string, string>());
  const send = (body: Parameters<typeof onFeedback>[0]) => {
    const payload = JSON.stringify(body);
    const key = keys.current.get(payload) ?? crypto.randomUUID();
    keys.current.set(payload, key);
    void onFeedback(body, key).then((saved) => {
      if (saved && keys.current.get(payload) === key) keys.current.delete(payload);
    });
  };
  const date = (value: string) => memoryDate(value, timeZone);
  const simplerRequests = teachingMemory ? memory.simplerRequests : [];
  const empty =
    !memory.needsPractice.length &&
    !memory.recalledRecently.length &&
    !memory.dismissed.length &&
    !simplerRequests.length;
  return (
    <Panel title={copy.noticedTitle}>
      <p className="preview-muted">{copy.noticedIntro}</p>
      {memory.lastEvidenceAt ? <p>{copy.latestEvidence(date(memory.lastEvidenceAt))}</p> : null}
      {empty ? <p>{copy.noEvidence}</p> : null}
      {memory.needsPractice.length ? (
        <section aria-labelledby="memory-practise">
          <h3 id="memory-practise">{copy.practiseTitle}</h3>
          <ul className="preview-list">
            {memory.needsPractice.map((item) => (
              <li key={item.learningItemId}>
                <Goal item={item} />
                <p>
                  {copy.practiseReason(
                    item.evidence.again,
                    date(item.evidence.lastAgainAt ?? item.evidence.lastReviewedAt),
                    item.evidence.recalledSinceLastAgain,
                  )}
                </p>
                <p className="preview-muted">
                  {copy.evidence(item.amount, item.evidence.reviews, sets(item))}
                </p>
                <Actions>
                  <LinkButton secondary href={item.next.href}>
                    {item.next.kind === "review_class"
                      ? copy.nextPractiseDueAction
                      : copy.nextPractiseCardAction}
                  </LinkButton>
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() =>
                      send({
                        learningItemId: item.learningItemId,
                        kind: "not_a_difficulty",
                        active: true,
                        shownLastAgainAt: item.evidence.lastAgainAt,
                      })
                    }
                  >
                    {copy.notDifficulty}
                  </Button>
                  {teachingMemory &&
                  (item.simplerApplies || item.feedback.explainSimplerAt !== null) ? (
                    // The label names the action, so it is not also an aria-pressed toggle.
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() =>
                        send({
                          learningItemId: item.learningItemId,
                          kind: "explain_simpler",
                          active: item.feedback.explainSimplerAt === null,
                        })
                      }
                    >
                      {item.feedback.explainSimplerAt === null
                        ? copy.explainSimpler
                        : copy.stopSimpler}
                    </Button>
                  ) : null}
                </Actions>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {memory.recalledRecently.length ? (
        <section aria-labelledby="memory-recalled">
          <h3 id="memory-recalled">{copy.recalledTitle}</h3>
          <ul className="preview-list">
            {memory.recalledRecently.map((item) => (
              <li key={item.learningItemId}>
                <Goal item={item} />
                <p>
                  {copy.recalledReason(
                    item.evidence.recalledSinceLastAgain,
                    date(item.evidence.lastReviewedAt),
                  )}
                </p>
                <p className="preview-muted">
                  {copy.evidence(item.amount, item.evidence.reviews, sets(item))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {memory.dismissed.length ? (
        <section aria-labelledby="memory-dismissed">
          <h3 id="memory-dismissed">{copy.dismissedTitle}</h3>
          <ul className="preview-list">
            {memory.dismissed.map((item) => (
              <li key={item.learningItemId}>
                <Goal item={item} />
                <p>{copy.dismissedReason(date(item.feedback.notADifficultyAt ?? ""))}</p>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    send({
                      learningItemId: item.learningItemId,
                      kind: "not_a_difficulty",
                      active: false,
                    })
                  }
                >
                  {copy.showAgain}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {simplerRequests.length ? (
        <section aria-labelledby="memory-simpler">
          <h3 id="memory-simpler">{copy.simplerTitle}</h3>
          <ul className="preview-list">
            {simplerRequests.map((item) => (
              <li key={item.learningItemId}>
                <Goal item={item} />
                <p>{copy.simplerReason(date(item.askedAt))}</p>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    send({
                      learningItemId: item.learningItemId,
                      kind: "explain_simpler",
                      active: false,
                    })
                  }
                >
                  {copy.stopSimpler}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="preview-muted">{copy.definitions}</p>
    </Panel>
  );
}
