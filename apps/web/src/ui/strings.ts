// Every UI string in one place (HANDOFF §0, copy.md). Words come verbatim from the design
// handoff: docs/design/handoff-r1/handoff/copy.md and the .dc.html frames. A string that is in
// neither must be an approved deviation in docs/design/HANDOFF_R1_REVIEW.md; strings.test.ts
// enforces this. Placeholders use {name} and are filled with fill().
// PERF-06: the words live in one module per area (strings-*.ts), so a client component can bundle
// only its area; this object composes them all with the same shape and order as before.
import { settingsStrings } from "./strings-settings";
import { setupStrings } from "./strings-setup";
import { shellStrings } from "./strings-shell";
import { signInStrings } from "./strings-sign-in";
import { statusStrings } from "./strings-status";

export const strings = {
  brand: shellStrings.brand,
  nav: shellStrings.nav,
  common: shellStrings.common,
  classStatus: statusStrings.classStatus,
  sourceStatus: statusStrings.sourceStatus,
  sourceChip: statusStrings.sourceChip,
  provenance: statusStrings.provenance,
  signIn: signInStrings.signIn,
  setup: setupStrings.setup,
  empty: shellStrings.empty,
  settings: settingsStrings.settings,
} as const;

export { fill } from "./strings-fill";
