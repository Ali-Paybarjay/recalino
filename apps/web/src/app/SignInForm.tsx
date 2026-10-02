"use client";

import { type ReactNode, useId, useState } from "react";
import { Button } from "../ui/components/Button";
import { Icon } from "../ui/components/Icon";
import { Sheet } from "../ui/components/Sheet";
import { Check, GoogleLogo, Info } from "../ui/icons";
import { fill, strings } from "../ui/strings";
import styles from "./SignIn.module.css";

type SignInFormProps = {
  /** Where to go after sign-in; already checked to be a path in the app. */
  next: string;
  terms: ReactNode;
  privacy: ReactNode;
};

/**
 * The A1 declarations (FR-ACC-001). Both boxes start unticked and the button stays unavailable,
 * with the reason, until both are ticked. Terms and Privacy open in a sheet, so the ticks are
 * kept. The form posts to the server, which stores the declarations before sending the browser
 * to Google.
 */
export function SignInForm({ next, terms, privacy }: SignInFormProps) {
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [sheet, setSheet] = useState<"terms" | "privacy" | null>(null);
  const reasonId = useId();
  const termsBoxId = useId();
  const ready = adult && accepted;
  const [before, after] = strings.signIn.accept.split("{terms}");
  const [between, end] = (after ?? "").split("{privacy}");

  return (
    <>
      <form method="post" action="/auth/start" className={styles.declarations}>
        <input type="hidden" name="next" value={next} />
        <label className={styles.row}>
          <input
            type="checkbox"
            name="adult"
            checked={adult}
            onChange={(event) => setAdult(event.target.checked)}
            className={`${styles.input} rc-visually-hidden`}
          />
          <span className={styles.box} aria-hidden="true">
            <Icon icon={Check} weight="bold" size={14} className={styles.mark} />
          </span>
          <span>{strings.signIn.adult}</span>
        </label>
        {/* Focus order (accessibility.md): Terms link, Privacy link, then the box. */}
        <div className={styles.row}>
          <span className={styles.text}>
            <label htmlFor={termsBoxId}>{before}</label>
            <button type="button" className={styles.link} onClick={() => setSheet("terms")}>
              {strings.signIn.terms}
            </button>
            <label htmlFor={termsBoxId}>{between}</label>
            <button type="button" className={styles.link} onClick={() => setSheet("privacy")}>
              {strings.signIn.privacy}
            </button>
            {end ? <label htmlFor={termsBoxId}>{end}</label> : null}
          </span>
          <input
            id={termsBoxId}
            type="checkbox"
            name="terms"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            aria-label={fill(strings.signIn.accept, {
              terms: strings.signIn.terms,
              privacy: strings.signIn.privacy,
            })}
            className={`${styles.input} rc-visually-hidden`}
          />
          {/* The square is a label too, so clicking it ticks the box. */}
          <label
            htmlFor={termsBoxId}
            className={`${styles.box} ${styles.boxFirst}`}
            aria-hidden="true"
          >
            <Icon icon={Check} weight="bold" size={14} className={styles.mark} />
          </label>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          icon={GoogleLogo}
          unavailable={!ready}
          aria-describedby={reasonId}
          className={styles.submit}
        >
          {strings.signIn.continue}
        </Button>
        <p id={reasonId} className={styles.hint}>
          <Icon icon={Info} className={styles.hintIcon} />
          <span>
            {ready ? null : `${strings.signIn.tickBoth} `}
            {strings.signIn.needGoogle}
          </span>
        </p>
      </form>
      <Sheet open={sheet === "terms"} onClose={() => setSheet(null)} title={strings.signIn.terms}>
        {terms}
      </Sheet>
      <Sheet
        open={sheet === "privacy"}
        onClose={() => setSheet(null)}
        title={strings.signIn.privacy}
      >
        {privacy}
      </Sheet>
    </>
  );
}
