import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardStatusSchema, cardTemplateSchema } from "@recalino/core/card";
import { SOURCE_KINDS } from "@recalino/core/src";
import { describe, expect, it } from "vitest";
import { adminTaskTitleCopy, pilotProgressCopy, systemHealthCopy } from "./admin/copy";
import { allowanceHelp } from "./allowance-copy";
import { experienceCopy } from "./experience-copy";
import { recordingCopy } from "./recording/recording-copy";
import { cardActionsCopy } from "./workspace/card-actions-copy";
import { cardStatusLabel, cardTemplateLabel, mediaAssetLabel } from "./workspace/card-labels";
import { workspaceErrors } from "./workspace/error-copy";
import { fileProcessingCopy } from "./workspace/file-processing";
import { learningProgressCopy } from "./workspace/learning-progress-copy";
import { privacyCopy } from "./workspace/privacy-copy";
import { processSessionCopy } from "./workspace/process-session-copy";
import { sessionMaterialCopy } from "./workspace/session-material-copy";
import { sourceKindLabel } from "./workspace/source-labels";

const register = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/design/UI_COPY_PENDING.md"),
  "utf8",
);
// The section where the owner's approval of 2026-10-19 (audit batch 5) is recorded.
const approved = register.slice(
  register.indexOf("## تأیید 2026-10-19 (ممیزی 2026-10-18، دستهٔ ۵"),
  register.indexOf("## تأیید 2026-10-19 — واژگان A"),
);

// The ten texts the owner approved word for word on 2026-10-19. They live in their screen's copy
// module (not in pending-copy.ts) and are recorded here, so neither can drift from the other.
// allowanceHelp.need and learningProgressCopy.waitEstimate were corrected on 2026-10-20 (D107);
// the D107 tests below hold them, and this section keeps the earlier wording as history.
const texts: Array<[string, string, string]> = [
  ["cardActionsCopy.rejected", cardActionsCopy.rejected, "Card rejected"],
  [
    "learningProgressCopy.termsGuidance",
    learningProgressCopy.termsGuidance,
    "Read and accept the updated Terms to continue.",
  ],
  [
    "privacyCopy.needsOperator",
    privacyCopy.needsOperator,
    "Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.",
  ],
  [
    "privacyCopy.downloadFirst",
    privacyCopy.downloadFirst,
    "To keep a copy first, open a session, choose More session tools, then Download notes and cards.",
  ],
  [
    "allowanceHelp.reserved",
    allowanceHelp.reserved,
    "Reserved allowance is held while your material is processed. Only usable published output is charged.",
  ],
  [
    "workspaceErrors.sourcesChanged",
    workspaceErrors.sourcesChanged,
    "The selected sources have changed. Check your session material, then try again.",
  ],
  [
    "experienceCopy.welcome.pilotNote",
    experienceCopy.welcome.pilotNote,
    "Built for a small pilot group. Sign in with Google to start.",
  ],
  [
    "learningProgressCopy.notificationQuestion + notificationAction",
    `${learningProgressCopy.notificationQuestion} ${learningProgressCopy.notificationAction}`,
    "Want a message when your notes are ready? Turn on notifications in Settings.",
  ],
];

describe("texts approved by the owner on 2026-10-19", () => {
  it("has a section in the register", () => {
    expect(approved.length).toBeGreaterThan(500);
  });

  it.each(texts)(
    "%s is in the interface and in the register, word for word",
    (key, text, owner) => {
      expect(text).toBe(owner);
      expect(approved).toContain(`«${owner}»`);
      expect(approved).toContain(key.split(" ")[0] as string);
    },
  );
});

// D89 (owner decision 2026-10-19, audit batch 9): the sentence for a result the operator still
// checks (UX-05, `provider_outcome_unresolved`), recorded in its own section of the register.
describe("the provider_outcome_unresolved sentence approved on 2026-10-19", () => {
  const section = register.slice(register.indexOf("## تأیید 2026-10-19 — دستهٔ ۹"));
  it("is in the interface and in the register, word for word", () => {
    const owner =
      "A result is still being checked. Contact the pilot operator before trying again.";
    expect(section.length).toBeGreaterThan(100);
    expect(workspaceErrors.outcomeUnresolved).toBe(owner);
    expect(section).toContain(`«${owner}»`);
    expect(section).toContain("workspaceErrors.outcomeUnresolved");
  });
});

// D97 (owner decision 2026-10-19, audit batch 14, OPS-02): the 16 texts of the admin overview's
// System health card, in English and Persian, each recorded word for word in its own section. The
// 17th, the failed_runs alert, was approved on 2026-11-03 (P1-09, E93) and joins the same section.
describe("the System health texts approved on 2026-10-19", () => {
  const section = register.slice(register.indexOf("## تأیید 2026-10-19 — System health"));
  const entries = (node: object, path: string[] = []): Array<[string, string, string]> =>
    Object.entries(node).flatMap(([key, value]) =>
      "en" in value && "fa" in value
        ? [[[...path, key].join("."), value.en as string, value.fa as string]]
        : entries(value, [...path, key]),
    );
  const texts = entries(systemHealthCopy);

  it("are the seventeen texts of the register section", () => {
    expect(section.length).toBeGreaterThan(500);
    expect(texts).toHaveLength(17);
    expect(section.match(/^\| .+ \| «.+» \| «.+» \|$/gm)).toHaveLength(17);
  });

  it.each(texts)("%s is in the admin console and in the register, word for word", (key, en, fa) => {
    expect(section).toContain(`(\`${key}\`) | «${en}» | «${fa}» |`);
  });
});

// D98 (owner decision 2026-10-19, audit batch 15, PRD-03 and OPS-02): the pilot progress columns,
// their empty value and the titles of the stopped-deletion and health-alert tasks, in English and
// Persian, each recorded word for word in its own section of the register.
describe("the pilot progress and task texts approved on 2026-10-19", () => {
  const start = register.indexOf("## تأیید 2026-10-19 — پیشرفت پایلوت و وظیفه‌های تازه");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));
  const entries = (node: object, path: string[]): Array<[string, string, string]> =>
    Object.entries(node).flatMap(([key, value]) =>
      "en" in value && "fa" in value
        ? [[[...path, key].join("."), value.en as string, value.fa as string]]
        : entries(value, [...path, key]),
    );
  const texts = [
    ...entries(pilotProgressCopy, ["pilotProgressCopy"]),
    ...entries(adminTaskTitleCopy, ["adminTaskTitleCopy"]),
  ];

  it("are the eight texts of the register section", () => {
    expect(start).toBeGreaterThan(-1);
    expect(texts).toHaveLength(8);
    expect(section.match(/^\| .+ \| «.+» \| «.+» \|$/gm)).toHaveLength(8);
  });

  it.each(texts)("%s is in the admin console and in the register, word for word", (key, en, fa) => {
    expect(section).toContain(`(\`${key}\`) | «${en}» | «${fa}» |`);
  });
});

// D100 (owner decision 2026-10-19, audit batch 17, UX-05): the card state and card type labels of
// card-labels.ts, approved as they are, each recorded word for word beside its stored value.
describe("the card labels approved on 2026-10-19", () => {
  const start = register.indexOf("## تأیید 2026-10-19 — برچسب‌های کارت");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));
  // The active card's label was approved later, on 2026-10-20 (D101, checked below).
  const labels: Array<[string, string]> = [
    ...cardStatusSchema.options
      .filter((status) => status !== "active")
      .map((status) => [status, cardStatusLabel(status)]),
    ...cardTemplateSchema.options.map((template) => [template, cardTemplateLabel(template)]),
  ].flatMap(([stored, label]) => (label ? [[stored as string, label]] : []));

  it("are the ten labels of the register section", () => {
    expect(start).toBeGreaterThan(-1);
    expect(labels).toHaveLength(10);
    expect(section.match(/^\| .+ \| `\w+` \| «.+» \|$/gm)).toHaveLength(10);
  });

  it.each(labels)("%s reads %s in the interface and in the register", (stored, label) => {
    expect(section).toContain(`| \`${stored}\` | «${label}» |`);
  });
});

// D101 (owner decision 2026-10-20, audit batch 19, UX-05): the rest of batch 5's proposals, each
// recorded word for word beside its stored value. The server's paused-processing sentence in the
// same section is checked by apps/web/src/server/automatic-learning-message.test.ts.
describe("the UX-05 texts approved on 2026-10-20", () => {
  const start = register.indexOf("## تأیید 2026-10-20 — متن‌های باقی‌ماندهٔ UX-05");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));
  const texts: Array<[string, string]> = [
    ["privacyCopy.accountHidden", privacyCopy.accountHidden],
    ["cardStatusLabel", cardStatusLabel("active") as string],
    ...SOURCE_KINDS.map((kind): [string, string] => ["sourceKindLabel", sourceKindLabel(kind)]),
    ["sourceKindLabel", sourceKindLabel("something_new")],
  ];

  it("are the ten texts of the register section", () => {
    expect(start).toBeGreaterThan(-1);
    expect(section.match(/^\| .+ \| .+ \| «.+» \|$/gm)).toHaveLength(10);
    expect(SOURCE_KINDS).toHaveLength(5);
  });

  it("keeps the deletion receipt and the active card's label word for word", () => {
    expect(privacyCopy.accountHidden).toBe(
      "Your account and sessions are hidden. The rest of your data is being removed.",
    );
    expect(cardStatusLabel("active")).toBe("In your review queue");
    expect(section).toContain("| `active` | «In your review queue» |");
    expect(cardStatusLabel("deleted")).toBeNull();
  });

  it.each(texts)("%s «%s» is in the interface and in the register", (key, text) => {
    expect(section).toContain(`(\`${key}\`)`);
    expect(section).toContain(`«${text}»`);
  });

  it("records the file types by their stored kind", () => {
    for (const kind of SOURCE_KINDS)
      expect(section).toContain(`| \`${kind}\` | «${sourceKindLabel(kind)}» |`);
    expect(section).toContain(`| — | «${sourceKindLabel("something_new")}» |`);
  });

  it("records the computer voice label of a card's media", () => {
    expect(mediaAssetLabel({ synthetic: true, state: "ready" }, 0)).toBe(
      "Computer voice 1 · Ready",
    );
    expect(section).toContain("| `ready` | «Computer voice N · Ready» |");
  });
});

// D102 (owner decision 2026-10-20): the class image label of a card's media and the account deletion
// sheet's sentence without "server cleanup" (UX-05).
describe("the card image label and deletion sheet approved on 2026-10-20", () => {
  const start = register.indexOf("## تأیید 2026-10-20 — برچسب تصویر کارت");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));

  it("records the class image label of a card's media", () => {
    expect(start).toBeGreaterThan(-1);
    expect(mediaAssetLabel({ synthetic: false, state: "ready" }, 1)).toBe("Class image 2 · Ready");
    expect(section).toContain("| `ready` | «Class image N · Ready» |");
  });

  it("records the deletion sheet's sentence word for word", () => {
    const view = readFileSync(resolve(import.meta.dirname, "workspace/PrivacyView.tsx"), "utf8");
    const sentence =
      "All your sessions and account data will disappear immediately. This cannot be undone.";
    expect(view.replace(/\s+/g, " ")).toContain(sentence);
    expect(view).not.toMatch(/server cleanup/i);
    expect(section).toContain(`«${sentence}»`);
  });
});

// D105 (owner decision 2026-10-20): the refusal of Process this session while a recording of the
// session is open. The other texts approved that day come with the interface that shows them.
describe("the Process this session refusal approved on 2026-10-20", () => {
  const start = register.indexOf("## تأیید 2026-10-20 — پردازش صریح جلسه");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));

  it("records the refusal word for word", () => {
    expect(start).toBeGreaterThan(-1);
    const sentence = "Stop the recording before you process this session.";
    expect(workspaceErrors.captureInProgress).toBe(sentence);
    expect(section).toContain("`capture_in_progress`");
    expect(section).toContain(`«${sentence}»`);
  });
});

// D106 (owner decision 2026-10-20): the add control at the end of the session material list.
describe("the session material text approved on 2026-10-20", () => {
  const start = register.indexOf("## تأیید 2026-10-20 — فهرست Session material (D106)");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));

  it("records Add more material word for word", () => {
    expect(start).toBeGreaterThan(-1);
    expect(sessionMaterialCopy.addMore).toBe("Add more material");
    expect(section).toContain(
      `| دکمهٔ پایان فهرست Session material (\`sessionMaterialCopy.addMore\`) | فهرست خالی نیست | «${sessionMaterialCopy.addMore}» |`,
    );
  });
});

// D107 (owner decision 2026-10-20): the recording page's list of this session's parts and the
// Process this session interface, with the five sentences that promised processing at Stop.
describe("the recording page and Process this session texts approved on 2026-10-20", () => {
  const start = register.indexOf("## تأیید 2026-10-20 — صفحهٔ ضبط و Process this session (D107)");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));
  const added: Array<[string, string, string]> = [
    ["processSessionCopy.action", processSessionCopy.action, "Process this session"],
    ["processSessionCopy.title", processSessionCopy.title, "Process this session?"],
    [
      "processSessionCopy.nothingYet",
      processSessionCopy.nothingYet,
      "Nothing is processed or charged until you confirm.",
    ],
    [
      "processSessionCopy.readyDetail",
      processSessionCopy.readyDetail,
      "Your notes and flashcards are made when you process this session.",
    ],
    ["recordingCopy.continueRecording", recordingCopy.continueRecording, "Continue recording"],
    [
      "recordingCopy.staysOpen",
      recordingCopy.staysOpen,
      "This session stays open. Record more, or process it when the class is over.",
    ],
    ["recordingCopy.recordedParts", recordingCopy.recordedParts, "Recorded parts"],
    ["recordingCopy.partTitle", recordingCopy.partTitle, "Part {n} · {duration}"],
  ];
  const sessionPage = readFileSync(
    resolve(import.meta.dirname, "../app/(app)/sessions/[id]/page.tsx"),
    "utf8",
  );
  const topics = {
    old: "Record this session or add material to get started. Your lesson title, notes and flashcards will appear automatically.",
    now: "Record this session or add material to get started. Your lesson title, notes and flashcards will appear after you process this session.",
  };
  const corrected: Array<[string, string, string, string]> = [
    [
      "recordingCopy.introduction",
      recordingCopy.introduction,
      "Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.",
      "Recorded parts are saved on this device and sent while you record; after Stop the last part is sent, and your notes are made when you process this session.",
    ],
    [
      "recordingCopy.materialNotice",
      recordingCopy.materialNotice,
      "After you stop recording, saved audio and board photos automatically create and save your session notes and flashcards. Audio stays on this device, with a temporary copy uploaded for transcription. Board photos are stored privately.",
      "When you process this session, saved audio and board photos create and save your session notes and flashcards. Audio stays on this device, with a temporary copy uploaded for transcription. Board photos are stored privately.",
    ],
    [
      "learningProgressCopy.waitEstimate",
      learningProgressCopy.waitEstimate,
      "Most sessions are ready within a few minutes after you stop recording. Longer recordings take longer. You can leave this page.",
      "Most sessions are ready within a few minutes after you process them. Longer recordings take longer. You can leave this page.",
    ],
    [
      "allowanceHelp.need",
      allowanceHelp.need,
      "The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.",
      "The pilot operator sets your allowance. Processing starts when you process a session, as long as your allowance covers it.",
    ],
    [
      "app/(app)/sessions/[id]/page.tsx",
      sessionPage.includes(topics.now) && !sessionPage.includes(topics.old) ? topics.now : "",
      topics.old,
      topics.now,
    ],
  ];

  it("has its own section in the register", () => {
    expect(start).toBeGreaterThan(-1);
    expect(register.indexOf("## تأیید 2026-10-19 — System health")).toBeGreaterThan(start);
  });

  it.each(added)(
    "%s is in the interface and in the register, word for word",
    (key, text, owner) => {
      expect(text).toBe(owner);
      expect(section).toContain(`\`${key}\` | «${owner}»`);
    },
  );

  it.each(corrected)(
    "%s is corrected from the old sentence to the new one",
    (key, text, old, now) => {
      expect(text).toBe(now);
      expect(section).toContain(key);
      expect(section).toContain(`«${old}» → «${now}»`);
    },
  );
});

// E160-R (owner approval 2026-11-07, P7-04, AUD-4 F-1): the File processing panel's text for
// uploaded files that wait for Process this session (D107).
describe("the File processing text approved on 2026-11-07", () => {
  const start = register.indexOf("## تأیید 2026-11-07 — پنل File processing");
  const section = register.slice(start, register.indexOf("\n## ", start + 1));

  it("records the waiting text word for word", () => {
    expect(start).toBeGreaterThan(-1);
    const sentence =
      "Your files are uploaded. To create your notes and flashcards, choose “Process this session”.";
    expect(fileProcessingCopy.awaitingProcess).toBe(sentence);
    expect(section).toContain(`| \`fileProcessingCopy.awaitingProcess\` | «${sentence}» |`);
    expect(section.match(/^\| .+ \| `.+` \| «.+» \|$/gm)).toHaveLength(1);
  });
});
