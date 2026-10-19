// PERF-06: one area of the UI strings, so a client component bundles only the words it shows.
// strings.ts composes every area into the one `strings` object, and strings.test.ts checks the
// origin of each string there (HANDOFF §0, copy.md).

/** Session and source status, and where content comes from. */
export const statusStrings = {
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
