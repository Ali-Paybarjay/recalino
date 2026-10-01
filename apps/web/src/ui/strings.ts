// Every UI string in one place (HANDOFF §0, copy.md). Words come verbatim from the design
// handoff: docs/design/handoff-r1/handoff/copy.md and the .dc.html frames. A string that is in
// neither must be an approved deviation in docs/design/HANDOFF_R1_REVIEW.md; strings.test.ts
// enforces this. Placeholders use {name} and are filled with fill().

export const strings = {
  brand: {
    name: "Recalino",
    wordmark: "recalino",
    tagline: "Turn your English class into clear notes and a short daily review.",
  },
  nav: {
    today: "Today",
    classes: "Classes",
    review: "Review",
    me: "Me",
    newClass: "New class",
    reviewDue: "{count} due",
    skipToContent: "Skip to content",
  },
  common: {
    close: "Close",
    undo: "Undo",
    tryAgain: "Try again",
    confirmIrreversible: "I understand this can't be undone",
  },
  classStatus: {
    readyToProcess: "Ready to process",
    waitingForAllowance: "Waiting for allowance",
    inQueue: "In queue",
    processing: "Processing",
    needsAction: "Needs your action",
    partlyReady: "Partly ready · {detail}",
    ready: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  sourceStatus: {
    onThisDevice: "On this device",
    sending: "Sending for processing…",
    sent: "Sent for processing",
    serverCopyDeleted: "Server copy deleted",
    notOnThisDevice: "Original audio isn't on this device",
    uploading: "Uploading {done}/{total}",
    checking: "Checking…",
    received: "Received",
    notAccepted: "Not accepted: {reason}",
    needsAction: "Needs your action: {action}",
  },
  sourceChip: {
    notOnThisDevice: "{label} · not on this device",
    notKept: "{label} · no longer kept",
  },
  provenance: {
    class: "From class",
    ai: "AI explanation",
    edited: "Edited by you",
    experimental: "Experimental quality",
    reportProblem: "Report a problem",
    computerVoice: "Computer voice",
  },
} as const;

/** Replaces each {name} in a template with its value. A missing value is an error, not a gap. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing value for {${name}}`);
    }
    return String(value);
  });
}
