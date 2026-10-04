"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "../components/Sheet";
import { AppShell } from "../shell/AppShell";
import { Wordmark } from "../shell/Wordmark";
import { usePreview } from "./PreviewContext";
import { Actions, Button, LinkButton, PageHeader, Panel } from "./primitives";
import { SourceViews } from "./SourceViews";
import { PREVIEW_SCREENS } from "./screens";
import { WorkspaceViews } from "./WorkspaceViews";

const LearningViews = dynamic(() =>
  import("./LearningViews").then((module) => module.LearningViews),
);
const AccountViews = dynamic(() => import("./AccountViews").then((module) => module.AccountViews));

const learning = new Set([
  "notes",
  "source",
  "edit-notes",
  "history",
  "transcript",
  "export",
  "cards",
  "card-types",
  "card-editor",
  "card-update",
  "review",
  "review-card",
  "review-answer",
  "review-summary",
  "progress",
]);
const account = new Set([
  "preferences",
  "allowance",
  "profile",
  "edit-language",
  "edit-explanations",
  "edit-goal",
  "edit-timezone",
  "renew-consent",
  "legal",
  "data-controls",
  "setup-explanations",
  "setup-goal",
  "setup-timezone",
]);
const workspace = new Set(["today", "classes", "course", "class", "new-class", "organize"]);

export function PreviewApp({ screen }: { screen: string }) {
  const { state, reset, message } = usePreview();
  const router = useRouter();
  const [confirmReset, setConfirmReset] = useState(false);
  const spec = PREVIEW_SCREENS.find((item) => item.key === screen);
  const recording = ["recording", "recording-paused"].includes(screen);
  const due = state.cards.filter((card) => card.status === "active").length;
  const needsLearning =
    ["notes", "source", "history", "transcript", "export", "card-update"].includes(screen) &&
    state.noteHistory.length === 0 &&
    !state.noteText;
  const content = (
    <>
      <div className="preview-toolbar">
        <p>Sample workspace — changes affect this preview only</p>
        <label className="preview-explorer">
          Explore screens
          <select
            aria-label="Explore screens"
            value={screen}
            onChange={(event) => router.push(`/preview/${event.target.value}`)}
          >
            {PREVIEW_SCREENS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <Button secondary onClick={() => setConfirmReset(true)}>
          Reset sample
        </Button>
      </div>
      {!recording && message ? (
        <p role="status" className="preview-muted">
          {message}
        </p>
      ) : null}
      <div className="preview-stack" key={screen}>
        {needsLearning ? (
          <>
            <PageHeader
              title={state.classes[0]?.title ?? "Your class"}
              description="A fresh learning space for this class."
              back="class"
            />
            <Panel title="No notes here yet">
              <p>
                Add this class’s material, or write your own notes. Each class keeps its own sources
                and edits.
              </p>
              <Actions>
                <LinkButton to="first-upload">Add sources</LinkButton>
                <LinkButton secondary to="edit-notes">
                  Write notes
                </LinkButton>
              </Actions>
            </Panel>
          </>
        ) : learning.has(screen) ? (
          <LearningViews screen={screen} />
        ) : account.has(screen) ? (
          <AccountViews screen={screen} />
        ) : workspace.has(screen) ? (
          <WorkspaceViews screen={screen} />
        ) : (
          <SourceViews screen={screen} />
        )}
      </div>
      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset sample workspace?"
      >
        <p>
          Your changes to this sample will be replaced with the original example. No real account is
          affected.
        </p>
        <Actions>
          <Button
            onClick={() => {
              reset();
              setConfirmReset(false);
              router.push("/preview/today");
            }}
          >
            Reset sample workspace
          </Button>
          <Button secondary onClick={() => setConfirmReset(false)}>
            Keep my changes
          </Button>
        </Actions>
      </Sheet>
    </>
  );
  return (
    <div className="preview-root">
      {spec?.focused ? (
        <main id="content" className="preview-focus">
          <div className="preview-wordmark">
            <Wordmark />
          </div>
          {content}
        </main>
      ) : (
        <AppShell
          current={
            (spec?.active === "me" ? "me" : (spec?.active ?? "today")) as
              | "today"
              | "classes"
              | "review"
              | "me"
          }
          hrefs={{
            today: "/preview/today",
            classes: "/preview/classes",
            review: "/preview/review",
            me: "/preview/profile",
          }}
          newClassHref="/preview/new-class"
          reviewDue={due}
          sidebarFooter={
            <p className="preview-muted">
              {state.allowance.minutes} audio minutes · {state.allowance.pages} pages / photos
              <br />
              Sample allowance
            </p>
          }
        >
          {content}
        </AppShell>
      )}
    </div>
  );
}
