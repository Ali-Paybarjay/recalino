/**
 * The Notifications panel (NotificationCenter) holds the switch for device notifications. A page
 * that invites the learner to turn them on only asks the panel to open, like "Read and accept"
 * asks the Terms banner (terms-notice-event.ts).
 */
export const OPEN_NOTIFICATIONS_EVENT = "recalino:open-notifications";

export function openNotifications(target: Pick<Window, "dispatchEvent"> = window): void {
  target.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
}
