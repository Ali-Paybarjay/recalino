"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "../../ui/components/Button";
import { Checkbox } from "../../ui/components/Checkbox";
import { Banner } from "../../ui/components/Feedback";
import { Sheet } from "../../ui/components/Sheet";
import { FileText } from "../../ui/icons";
import { fill, strings } from "../../ui/strings";
import { acceptTexts, SaveError } from "../setup/api";
import styles from "./app.module.css";

/**
 * FR-ACC-007 (frame G3): a calm banner; "Read and accept" opens the texts with the same tick as
 * the sign-in page. Until then only new processing waits.
 */
export function TermsNotice({
  versions,
  changedOn,
  terms,
  privacy,
}: {
  versions: { terms: string; privacy: string };
  /** e.g. "1 Oct"; worked out on the server, so the texts never reach the browser bundle. */
  changedOn: string;
  terms: ReactNode;
  privacy: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await acceptTexts([
        { document: "terms", version: versions.terms },
        { document: "privacy", version: versions.privacy },
      ]);
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof SaveError ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <>
      <Banner
        tone="warning"
        icon={FileText}
        action={
          <Button className={styles.onSurface} onClick={() => setOpen(true)}>
            {strings.settings.readAndAccept}
          </Button>
        }
      >
        {fill(strings.settings.termsChanged, { date: changedOn })}
      </Banner>
      <Sheet open={open} onClose={() => setOpen(false)} title={strings.signIn.terms}>
        {terms}
        <h2 className={styles.sheetHeading}>{strings.signIn.privacy}</h2>
        {privacy}
        <Checkbox
          label={fill(strings.signIn.accept, {
            terms: strings.signIn.terms,
            privacy: strings.signIn.privacy,
          })}
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          block
          unavailable={!accepted}
          loading={saving}
          onClick={accept}
        >
          {strings.setup.continue}
        </Button>
      </Sheet>
    </>
  );
}
