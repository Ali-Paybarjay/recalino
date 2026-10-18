"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";
import { accountCopy } from "../../ui/account-copy";
import { Button } from "../../ui/components/Button";
import { Checkbox } from "../../ui/components/Checkbox";
import { Banner } from "../../ui/components/Feedback";
import { Sheet } from "../../ui/components/Sheet";
import { FileText } from "../../ui/icons";
import { fill, strings } from "../../ui/strings";
import { OPEN_TERMS_NOTICE_EVENT } from "../../ui/workspace/terms-notice-event";
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
  const pathname = usePathname();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<"terms" | "privacy">("terms");
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);

  // A stopped session's next step opens this sheet too (UX-09).
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_TERMS_NOTICE_EVENT, show);
    return () => window.removeEventListener(OPEN_TERMS_NOTICE_EVENT, show);
  }, []);

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
      setError(failure instanceof SaveError ? failure : new SaveError(accountCopy.error.save));
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
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={accountCopy.legal.title}
        variant="reading"
        footer={
          <>
            <Checkbox
              label={fill(strings.signIn.accept, {
                terms: strings.signIn.terms,
                privacy: strings.signIn.privacy,
              })}
              checked={accepted}
              disabled={saving}
              aria-describedby={!accepted ? hintId : undefined}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            {!accepted ? (
              <p id={hintId} className={styles.note}>
                {accountCopy.legal.acceptHint}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className={styles.error}>
                {error.message}
                {error.status === 401 ? (
                  <Link href={`/?next=${encodeURIComponent(pathname)}`}>
                    {accountCopy.error.signIn}
                  </Link>
                ) : null}
              </p>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              block
              unavailable={!accepted}
              aria-describedby={!accepted ? hintId : undefined}
              loading={saving}
              onClick={accept}
            >
              {saving ? accountCopy.saving : accountCopy.accept}
            </Button>
            <Button disabled={saving} onClick={() => setOpen(false)}>
              {accountCopy.legal.close}
            </Button>
          </>
        }
      >
        <fieldset className={styles.legalNavigation} aria-label={accountCopy.legal.title}>
          <Button
            variant={document === "terms" ? "primary" : "secondary"}
            aria-pressed={document === "terms"}
            onClick={() => setDocument("terms")}
          >
            {strings.signIn.terms}
          </Button>
          <Button
            variant={document === "privacy" ? "primary" : "secondary"}
            aria-pressed={document === "privacy"}
            onClick={() => setDocument("privacy")}
          >
            {strings.signIn.privacy}
          </Button>
        </fieldset>
        {document === "terms" ? terms : privacy}
      </Sheet>
    </>
  );
}
