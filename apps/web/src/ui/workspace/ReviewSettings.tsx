"use client";
import type { ReviewSettings as Settings } from "@recalino/core/srs";
import { useState } from "react";
import { userMessage, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
export function ReviewSettings({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <Panel title="Choose a comfortable pace">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setProblem("");
          try {
            setSettings(
              await workspaceRequest<Settings>("/api/review/settings", "PATCH", settings),
            );
            setNotice("Review settings saved.");
          } catch (failure) {
            setProblem(userMessage(failure, "Settings could not be saved."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Answer choices">
          <select
            value={settings.mode}
            onChange={(event) =>
              setSettings({ ...settings, mode: event.target.value as Settings["mode"] })
            }
          >
            <option value="simple">Simple: Forgot / Remembered</option>
            <option value="advanced">Advanced: Again / Hard / Good / Easy</option>
          </select>
        </Field>
        <Field
          label="New cards per study day"
          hint="Your study day starts at 4 a.m. in your profile time zone."
        >
          <input
            type="number"
            min={0}
            max={100}
            value={settings.dailyNewLimit}
            onChange={(event) =>
              setSettings({ ...settings, dailyNewLimit: Number(event.target.value) })
            }
            required
          />
        </Field>
        <Field
          label="Practice target in minutes"
          hint="A gentle reminder, so you can stop or continue."
        >
          <input
            type="number"
            min={1}
            max={180}
            value={settings.timeBudgetMinutes}
            onChange={(event) =>
              setSettings({ ...settings, timeBudgetMinutes: Number(event.target.value) })
            }
            required
          />
        </Field>
        <Field
          label="Desired retention"
          hint="Higher retention usually means more frequent reviews."
        >
          <input
            type="number"
            min={0.7}
            max={0.97}
            step={0.01}
            value={settings.desiredRetention}
            onChange={(event) =>
              setSettings({ ...settings, desiredRetention: Number(event.target.value) })
            }
            required
          />
        </Field>
        {problem && <Status tone="error">{problem}</Status>}
        {notice && <Status tone="success">{notice}</Status>}
        <Actions>
          <Button type="submit" disabled={busy}>
            Save review settings
          </Button>
          <LinkButton secondary href="/review">
            Back to review
          </LinkButton>
        </Actions>
      </form>
    </Panel>
  );
}
