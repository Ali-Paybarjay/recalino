import "server-only";

/**
 * The UI test pages under /dev exist in development, and in a production build only when
 * RECALINO_DEV_UI=1, which only the CI end-to-end job sets. They are never part of the pilot.
 */
export { devUiEnabled } from "./local-test-policy";
