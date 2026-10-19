"use client";

import { type ReactNode, useState } from "react";
import { accountCopy } from "../../../ui/account-copy";
import { Button } from "../../../ui/components/Button";
import { Icon } from "../../../ui/components/Icon";
import { Sheet } from "../../../ui/components/Sheet";
import { CaretRight, FileText } from "../../../ui/icons";
import { shellStrings } from "../../../ui/strings-shell";
import { signInStrings } from "../../../ui/strings-sign-in";
import appStyles from "../app.module.css";
import styles from "./profile.module.css";

// PERF-06: only the string areas this component shows.
const strings = { ...shellStrings, ...signInStrings };

/**
 * UX-07: the Terms and the Privacy Notice stay readable after sign-in, from Settings. The same
 * reading sheet as the sign-in page and the Terms banner, without the accept box: reading changes
 * nothing, and accepting new versions stays with the banner (FR-ACC-007).
 */
export function LegalTexts({ terms, privacy }: { terms: ReactNode; privacy: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<"terms" | "privacy">("terms");
  return (
    <>
      <button type="button" className={styles.row} onClick={() => setOpen(true)}>
        <span className={styles.rowIcon}>
          <Icon icon={FileText} size={22} />
        </span>
        <span className={styles.rowLabel}>{accountCopy.legal.title}</span>
        <span className={styles.rowValue}>
          {strings.signIn.terms} · {strings.signIn.privacy}
        </span>
        <Icon icon={CaretRight} size={18} className={styles.rowCaret} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={accountCopy.legal.title}
        variant="reading"
        footer={<Button onClick={() => setOpen(false)}>{strings.common.close}</Button>}
      >
        <fieldset className={appStyles.legalNavigation} aria-label={accountCopy.legal.title}>
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
