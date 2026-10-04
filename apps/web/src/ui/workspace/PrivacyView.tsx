"use client";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { useRecording } from "../recording/RecordingProvider";
import { type PendingDeletion, requestKey, WorkspaceRequestError, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import {
  DeletionOutcomeUnknownError,
  type DeletionReceipt,
  submitAccountDeletion,
} from "./privacy-actions";

export function PrivacyView({
  initialPending = null,
}: {
  initialPending?: PendingDeletion | null;
}) {
  const { controller, state, store, userId } = useRecording();
  const captureActive = ["starting", "recording", "paused", "saving"].includes(state.phase);
  const [confirm, setConfirm] = useState(false),
    [acknowledged, setAcknowledged] = useState(!!initialPending),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [receipt, setReceipt] = useState<DeletionReceipt | null>(null),
    [pending, setPending] = useState<PendingDeletion | null>(initialPending),
    [uncertain, setUncertain] = useState(false),
    [deviceCleanup, setDeviceCleanup] = useState<"pending" | "complete" | "failed">("pending");
  const key = useRef<{ payload: string; key: string } | null>(
    initialPending
      ? {
          payload: JSON.stringify({ action: "delete_account" }),
          key: `delete-account:${initialPending.requestId}`,
        }
      : null,
  );
  useEffect(() => {
    if (!initialPending) return;
    void controller.prepareAccountDeletion().catch(() => {
      setProblem("Stop and save your active recording before finishing deletion.");
    });
  }, [controller, initialPending]);
  async function remove() {
    if (!acknowledged || busy || captureActive) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await submitAccountDeletion(
        controller,
        () =>
          workspaceRequest<DeletionReceipt>(
            "/api/privacy/account",
            "DELETE",
            { confirm: "DELETE" },
            requestKey(key, { action: "delete_account" }),
          ),
        !!pending || uncertain,
      );
      setReceipt(result);
      setConfirm(false);
      await clearDeviceData();
    } catch (failure) {
      if (failure instanceof WorkspaceRequestError && failure.deletion) {
        setPending(failure.deletion);
        setConfirm(false);
      } else if (failure instanceof DeletionOutcomeUnknownError) {
        setUncertain(true);
        setProblem(failure.message);
        setConfirm(false);
      } else {
        setProblem(
          failure instanceof Error
            ? failure.message
            : "Your account deletion request could not be saved. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function clearDeviceData() {
    setDeviceCleanup("pending");
    try {
      await store.removeAccount(userId);
      setDeviceCleanup("complete");
    } catch {
      setDeviceCleanup("failed");
    }
  }
  if (receipt)
    return (
      <Panel title="Account deletion requested">
        <Status>Your account and classes are hidden. Server cleanup has been queued.</Status>
        <p>Request reference: {receipt.id}</p>
        {deviceCleanup === "complete" ? (
          <Status>
            Saved recordings and photos for this account were removed from this browser.
          </Status>
        ) : deviceCleanup === "pending" ? (
          <Status>Removing this account’s saved recordings and photos from this browser…</Status>
        ) : (
          <>
            <Status tone="error">
              Your server deletion request was accepted, but this browser could not clear its saved
              recordings and photos.
            </Status>
            <Button secondary onClick={() => void clearDeviceData()}>
              Retry device cleanup
            </Button>
          </>
        )}
        <p>
          Copies on other devices and files you downloaded remain under your control. Remove those
          copies separately.
        </p>
        <LinkButton href="/">Return to Recalino</LinkButton>
      </Panel>
    );
  if (pending)
    return (
      <Panel title="Finish account deletion">
        <Status tone="error">
          {initialPending
            ? "Your account and classes are already hidden. Confirm the request to finish deletion on this browser."
            : "Your account and classes are already hidden. The deletion receipt still needs to be saved."}
        </Status>
        <p>Request reference: {pending.requestId}</p>
        <p>
          Recording remains unavailable while deletion is being finalized. Saved device copies will
          be removed after the request is confirmed.
        </p>
        {problem && <Status tone="error">{problem}</Status>}
        <Button disabled={busy} onClick={remove}>
          {busy ? "Finishing…" : "Finish deletion"}
        </Button>
      </Panel>
    );
  if (uncertain)
    return (
      <Panel title="Check your deletion request">
        <Status tone="error">
          We could not confirm whether the server received your deletion request.
        </Status>
        <p>
          New recording is unavailable until this request is checked. Your saved recordings and
          photos remain on this browser. Checking sends the same request again and will not create
          another deletion.
        </p>
        {problem && <Status tone="error">{problem}</Status>}
        <Button disabled={busy} onClick={remove}>
          {busy ? "Checking…" : "Check deletion request"}
        </Button>
      </Panel>
    );
  return (
    <div className="preview-stack">
      <Panel title="Your data, your choices">
        <p>
          You can remove an individual class from its Class options page, or remove a source from
          its Sources page.
        </p>
        <p>
          Removing a source from one class keeps its other uses. Deleting its original file keeps
          saved extraction and derived notes. Complete deletion removes derived content from every
          affected class.
        </p>
        <p>
          Shared cards and source files are checked before class cleanup. Files already downloaded
          cannot be removed from your devices by Recalino.
        </p>
        <Actions>
          <LinkButton secondary href="/classes">
            Choose a class
          </LinkButton>
          <LinkButton secondary href="/me">
            Back to settings
          </LinkButton>
        </Actions>
      </Panel>
      <Panel title="Delete your account">
        <p>
          This immediately hides your account and every class, stops processing, and queues server
          files, notes, cards, review history and learning preferences for removal. Account deletion
          cannot be undone.
        </p>
        <p>
          Saved recordings and photos for this account will also be removed from this browser.
          Copies on other devices and files you downloaded need to be removed separately.
        </p>
        {captureActive && (
          <Status>Stop and save your active recording before deleting your account.</Status>
        )}
        {["recording", "paused"].includes(state.phase) && (
          <Button secondary onClick={() => void controller.stop()}>
            Stop and save before deletion
          </Button>
        )}
        {problem && <Status tone="error">{problem}</Status>}
        <Button
          secondary
          disabled={captureActive}
          onClick={() => {
            setAcknowledged(false);
            setConfirm(true);
          }}
        >
          Review account deletion
        </Button>
      </Panel>
      <Sheet
        open={confirm}
        title="Delete your account?"
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
      >
        <p>
          All your classes and account data will disappear immediately, and server cleanup will
          begin. This cannot be undone.
        </p>
        <Field label="I understand that account deletion cannot be undone">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
        </Field>
        {captureActive && (
          <Status>Stop and save your active recording before deleting your account.</Status>
        )}
        {problem && <Status tone="error">{problem}</Status>}
        <Actions>
          <Button secondary disabled={busy} onClick={() => setConfirm(false)}>
            Keep my account
          </Button>
          <Button disabled={busy || !acknowledged || captureActive} onClick={remove}>
            {busy ? "Requesting deletion…" : "Delete account"}
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
