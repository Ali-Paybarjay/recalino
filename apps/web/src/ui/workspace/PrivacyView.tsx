"use client";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { PushSafeSignOut } from "../notifications/PushSafeSignOut";
import { useRecording } from "../recording/RecordingProvider";
import { settingsStrings as strings } from "../strings-settings";
import {
  type PendingDeletion,
  requestKey,
  userMessage,
  WorkspaceRequestError,
  workspaceRequest,
} from "./api";
import { IndexedManualAudioStore } from "./manual-audio-store";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import {
  DeletionOutcomeUnknownError,
  type DeletionReceipt,
  submitAccountDeletion,
} from "./privacy-actions";
import { privacyCopy } from "./privacy-copy";
import { IndexedUploadStore } from "./upload-store";

const DELETION_FAILED = "Your account deletion request could not be saved. Try again.";

/**
 * `initialPending` is an account that is already hidden. `recoveryStage` says what is left (UX-10):
 * the receipt still needs saving (the learner confirms it), or it is saved and cleanup is under
 * way or waits for the operator (nothing to confirm; the learner can sign out).
 */
export function PrivacyView({
  initialPending = null,
  recoveryStage = "journal_unsaved",
  operatorMailto = null,
}: {
  initialPending?: PendingDeletion | null;
  recoveryStage?: "journal_unsaved" | "in_progress" | "needs_operator";
  /** mailto link to the pilot operator, when the server has one configured. */
  operatorMailto?: string | null;
}) {
  const underway = !!initialPending && recoveryStage !== "journal_unsaved";
  const { controller, state, store, userId } = useRecording();
  const captureActive = ["starting", "recording", "paused", "saving"].includes(state.phase);
  const [confirm, setConfirm] = useState(false),
    [acknowledged, setAcknowledged] = useState(!!initialPending),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [receipt, setReceipt] = useState<DeletionReceipt | null>(
      underway && initialPending
        ? {
            id: initialPending.requestId,
            state: recoveryStage === "needs_operator" ? "needs_operator" : "pending",
            requestedAt: "",
          }
        : null,
    ),
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once for the recovered request.
  useEffect(() => {
    if (!initialPending) return;
    void controller
      .prepareAccountDeletion()
      .then(async () => {
        // The receipt is already saved: only this browser's copies are left to remove.
        if (!underway) return;
        controller.completeAccountDeletion();
        await clearDeviceData();
      })
      .catch(() => {
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
        setProblem(userMessage(failure, DELETION_FAILED));
        setConfirm(false);
      } else {
        setProblem(userMessage(failure, DELETION_FAILED));
      }
    } finally {
      setBusy(false);
    }
  }
  async function clearDeviceData() {
    setDeviceCleanup("pending");
    try {
      const results = await Promise.allSettled([
        store.removeAccount(userId),
        new IndexedUploadStore().removeAccount(userId),
        new IndexedManualAudioStore().removeAccount(userId),
        Promise.resolve().then(() => {
          const prefixes = ["batch", "photos", "recording"].map(
            (kind) => `recalino:learning-${kind}:${userId}:`,
          );
          const keys = Array.from({ length: localStorage.length }, (_, index) =>
            localStorage.key(index),
          );
          for (const key of keys)
            if (key && prefixes.some((prefix) => key.startsWith(prefix)))
              localStorage.removeItem(key);
        }),
      ]);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Device cleanup failed");
      setDeviceCleanup("complete");
    } catch {
      setDeviceCleanup("failed");
    }
  }
  if (receipt)
    return (
      <Panel title="Account deletion requested">
        {/* UX-10: while cleanup waits for the pilot operator the receipt says so (approved
            2026-10-19). UX-05: the other state no longer speaks of a "queue" (approved
            2026-10-20, D101). */}
        {receipt.state === "needs_operator" ? (
          <Status tone="error">{privacyCopy.needsOperator}</Status>
        ) : (
          <Status>{privacyCopy.accountHidden}</Status>
        )}
        <p>Request reference: {receipt.id}</p>
        {deviceCleanup === "complete" ? (
          <Status>
            Saved recordings, photos and pending uploads for this account were removed from this
            browser.
          </Status>
        ) : deviceCleanup === "pending" ? (
          <Status>
            Removing this account’s saved recordings, photos and pending uploads from this browser…
          </Status>
        ) : (
          <>
            <Status tone="error">
              Your server deletion request was accepted, but this browser could not clear its saved
              recordings, photos and pending uploads.
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
        {receipt.state === "needs_operator" && operatorMailto ? (
          <LinkButton href={operatorMailto}>Ask the pilot operator</LinkButton>
        ) : null}
        {/* Leaving by "/" would only come back to this page until cleanup has ended the session. */}
        <PushSafeSignOut label={strings.settings.signOut} />
      </Panel>
    );
  if (pending)
    return (
      <Panel title="Finish account deletion">
        <Status tone="error">
          {initialPending
            ? "Your account and sessions are already hidden. Confirm the request to finish deletion on this browser."
            : "Your account and sessions are already hidden. The deletion receipt still needs to be saved."}
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
        <PushSafeSignOut label={strings.settings.signOut} />
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
        <PushSafeSignOut label={strings.settings.signOut} />
      </Panel>
    );
  return (
    <div className="workspace-stack">
      <Panel title="Your data, your choices">
        <p>{privacyCopy.downloadFirst}</p>
        <p>
          You can remove an individual session from its Session options page, or remove material
          from its Session material page.
        </p>
        <p>
          Removing material from one session keeps its other uses. Deleting its original file keeps
          saved extraction and derived notes. Complete deletion removes derived content from every
          affected session.
        </p>
        <p>
          Shared cards and material files are checked before session cleanup. Files already
          downloaded cannot be removed from your devices by Recalino.
        </p>
        <Actions>
          <LinkButton secondary href="/sessions">
            Choose a session
          </LinkButton>
          <LinkButton secondary href="/me">
            Back to settings
          </LinkButton>
        </Actions>
      </Panel>
      <Panel title="Delete your account">
        <p>
          This immediately hides your account and every session, stops processing, and queues server
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
          All your sessions and account data will disappear immediately, and server cleanup will
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
          <Button danger disabled={busy || !acknowledged || captureActive} onClick={remove}>
            {busy ? "Requesting deletion…" : "Delete account"}
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
