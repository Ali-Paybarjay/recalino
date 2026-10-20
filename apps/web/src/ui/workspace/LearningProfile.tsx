"use client";
import type { LearningOverview } from "@recalino/core/pers";
import { useState } from "react";
import { userMessage, workspaceRequest } from "./api";
import { LearningMemoryPanel, NextStepPanel } from "./LearningMemory";
import { learningMemoryCopy } from "./learning-memory-copy";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
/**
 * `teachingMemory` follows the D49 release switch: while memory does not reach generation,
 * the controls that would promise a change in later lessons are not offered.
 */
export function LearningProfile({
  initial,
  teachingMemory = false,
}: {
  initial: LearningOverview;
  teachingMemory?: boolean;
}) {
  const [overview, setOverview] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  async function change(body: unknown) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      setOverview(
        await workspaceRequest<LearningOverview>("/api/learning/preferences", "PATCH", body),
      );
      setNotice("Your learning preference is saved.");
    } catch (failure) {
      setProblem(userMessage(failure, "Preference could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  async function feedback(body: unknown, key: string): Promise<boolean> {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      setOverview(
        await workspaceRequest<LearningOverview>("/api/learning/feedback", "POST", body, key),
      );
      setNotice(learningMemoryCopy.saved);
      return true;
    } catch (failure) {
      setProblem(userMessage(failure, learningMemoryCopy.failed));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-stack">
      {problem && <Status tone="error">{problem}</Status>}
      {notice && <Status tone="success">{notice}</Status>}
      <NextStepPanel memory={overview.memory} timeZone={overview.timezone} />
      <Panel title="Your practice in the last 30 days">
        <dl className="workspace-metrics">
          <div>
            <dt>Answers saved</dt>
            <dd>{overview.activity.answers}</dd>
          </div>
          <div>
            <dt>Different cards practised</dt>
            <dd>{overview.activity.differentCards}</dd>
          </div>
          <div>
            <dt>Cards accepted</dt>
            <dd>{overview.acceptedCards}</dd>
          </div>
          <div>
            <dt>Reviews due</dt>
            <dd>{overview.dueCards}</dd>
          </div>
        </dl>
        {!overview.activity.answers && (
          <p>Not enough practice history yet. A short review will start your record.</p>
        )}
        <p className="workspace-muted">
          Undone answers are excluded. Review choices describe this practice; they are not a
          language test.
        </p>
        <Actions>
          <LinkButton href="/review">Open review</LinkButton>
          <LinkButton secondary href="/me/review-settings">
            Set your pace
          </LinkButton>
        </Actions>
      </Panel>
      <Panel title="Your English level">
        <h3>
          {overview.profile.level === "not_sure"
            ? "Not sure"
            : (overview.profile.level ?? "Not chosen")}
        </h3>
        <p>Chosen by you · Goal: {overview.profile.goal ?? "Not chosen"}</p>
        <p>Estimated support level: Unknown.</p>
        <p className="workspace-muted">
          {overview.supportEstimate.evidenceCount} review answers in the last 30 days. Flashcard
          answers alone cannot establish a CEFR level. Speaking is unknown without an appropriate
          assessment.
        </p>
        <LinkButton secondary href="/me/edit/level-goal">
          Edit level and goal
        </LinkButton>
      </Panel>
      <LearningMemoryPanel
        memory={overview.memory}
        timeZone={overview.timezone}
        busy={busy}
        onFeedback={feedback}
        teachingMemory={teachingMemory}
      />
      <Panel title="Your practice over time">
        {overview.activity.history.length ? (
          <table>
            <caption>
              Saved answers per study day, using the time zone at the time of review
            </caption>
            <thead>
              <tr>
                <th scope="col">Study day</th>
                <th scope="col">Answers</th>
                <th scope="col">Again / Forgot</th>
              </tr>
            </thead>
            <tbody>
              {overview.activity.history.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{day.day}</th>
                  <td>{day.answers}</td>
                  <td>{day.again}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Your review history will appear here.</p>
        )}
      </Panel>
      <Panel title="How you like to learn">
        <Field
          label="Use shorter examples"
          hint="An explicit choice applies to future generation. Existing notes and cards stay as you saved them."
        >
          <select
            disabled={busy}
            value={overview.shorterExamples ? "yes" : "no"}
            onChange={(event) =>
              change({ action: "set_shorter_examples", value: event.target.value === "yes" })
            }
          >
            <option value="no">Standard examples</option>
            <option value="yes">Shorter examples</option>
          </select>
        </Field>
        {teachingMemory ? (
          <Field label={learningMemoryCopy.simplerLabel} hint={learningMemoryCopy.simplerHint}>
            <select
              disabled={busy}
              value={overview.simplerExplanations ? "yes" : "no"}
              onChange={(event) =>
                change({ action: "set_simpler_explanations", value: event.target.value === "yes" })
              }
            >
              <option value="no">{learningMemoryCopy.simplerStandard}</option>
              <option value="yes">{learningMemoryCopy.simplerOn}</option>
            </select>
          </Field>
        ) : null}
        {overview.suggestion ? (
          <>
            <h3>Try shorter examples?</h3>
            <p>
              You shortened {overview.suggestion.evidenceCount} answers across{" "}
              {overview.suggestion.classes} sessions. This suggestion changes nothing until you
              accept it.
            </p>
            <Actions>
              <Button disabled={busy} onClick={() => change({ action: "accept_shorter_examples" })}>
                Accept suggestion
              </Button>
              <Button
                secondary
                disabled={busy}
                onClick={() => change({ action: "dismiss_shorter_examples" })}
              >
                Dismiss suggestion
              </Button>
            </Actions>
          </>
        ) : (
          <p>No new preference suggestion. A single edit does not change your teaching style.</p>
        )}
        <Button secondary disabled={busy} onClick={() => change({ action: "reset_suggestions" })}>
          Reset suggested preferences
        </Button>
        <p className="workspace-muted">Reset keeps your explicit choice.</p>
      </Panel>
    </div>
  );
}
