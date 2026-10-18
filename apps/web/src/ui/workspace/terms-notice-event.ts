/**
 * "Read and accept" can start from any page: the banner (TermsNotice) is on every signed-in page
 * while new Terms wait, and a stopped session names the same action as its next step (UX-09).
 * The banner owns the sheet, so other components only ask it to open.
 */
export const OPEN_TERMS_NOTICE_EVENT = "recalino:open-terms-notice";

export function openTermsNotice(target: Pick<Window, "dispatchEvent"> = window): void {
  target.dispatchEvent(new Event(OPEN_TERMS_NOTICE_EVENT));
}
