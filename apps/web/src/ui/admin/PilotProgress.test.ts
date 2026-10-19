import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminScreenProps, PanelMode } from "./AdminScreenProps";
import { CoreScreens, dateLabel, taskDestination } from "./CoreScreens";
import type { AdminLocale, AdminSnapshot, AdminTask, AdminUser, PilotProgress } from "./contracts";
import { QuotaScreens } from "./QuotaScreens";

// Synthetic data only (G11): one learner part-way through the pilot, and one without progress data.
const progress: PilotProgress = {
  firstSignInAt: "2026-10-05T08:00:00.000Z",
  setupCompletedAt: "2026-10-05T08:10:00.000Z",
  firstRecordingAt: "2026-10-06T09:30:00.000Z",
  firstProcessedAt: null,
  firstReviewAt: null,
};
const learner: AdminUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Synthetic learner",
  email: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  pilot: true,
  quotaActive: true,
  welcomeState: "sent",
  progress,
};
const unread: AdminUser = { ...learner, id: "00000000-0000-4000-8000-000000000002" };
delete unread.progress;

const columns = {
  en: [
    "First sign-in",
    "Setup finished",
    "First class audio",
    "First session processed",
    "First review",
  ],
  fa: ["نخستین ورود", "پایان راه‌اندازی", "نخستین صوت کلاس", "نخستین جلسهٔ پردازش‌شده", "نخستین مرور"],
} as const;
const notYet = { en: "Not yet", fa: "هنوز نه" } as const;
const reached = [progress.firstSignInAt, progress.setupCompletedAt, progress.firstRecordingAt];

function screenProps(data: AdminSnapshot, mode: PanelMode, locale: AdminLocale): AdminScreenProps {
  const ignore = () => undefined;
  return {
    data,
    locale,
    t: (en, fa) => (locale === "fa" ? fa : en),
    mode,
    userId: data.user?.id ?? "",
    threadId: "",
    selected: [],
    setSelected: ignore,
    navigate: ignore,
    compose: ignore,
    act: async () => null,
    busy: false,
    search: "",
    setSearch: ignore,
    reload: ignore,
    localeChange: ignore,
    theme: "system",
    themeChange: ignore,
  };
}
const usersList = (locale: AdminLocale, users: AdminUser[] = [learner]) =>
  renderToStaticMarkup(
    createElement(CoreScreens, screenProps({ view: "users", users }, "users", locale)),
  );
const userDetails = (locale: AdminLocale, user: AdminUser = learner) =>
  renderToStaticMarkup(
    createElement(QuotaScreens, screenProps({ view: "user", user }, "user", locale)),
  );
const count = (html: string, text: string) => html.split(text).length - 1;

// PRD-03 (D96, D98): when each learner reached each pilot step, as dates only.
describe.each(["en", "fa"] as const)("pilot progress columns (%s)", (locale) => {
  it.each([
    ["users list", usersList],
    ["user details", userDetails],
  ] as const)("the %s shows the five steps with their dates", (_, render) => {
    const html = render(locale);
    for (const column of columns[locale]) expect(html).toContain(`<th scope="col">${column}</th>`);
    for (const date of reached) expect(html).toContain(`<td>${dateLabel(date, locale)}</td>`);
    // The two steps the learner has not reached yet.
    expect(count(html, `<td>${notYet[locale]}</td>`)).toBe(2);
    const other = locale === "en" ? "fa" : "en";
    for (const column of columns[other]) expect(html).not.toContain(column);
  });
});

describe("pilot progress without data", () => {
  it("shows a dash in the users list rather than claiming a step was not reached", () => {
    const html = usersList("en", [unread]);
    expect(html).not.toContain("Not yet");
    expect(count(html, "<td>—</td>")).toBe(5);
  });

  it("leaves the steps out of the user details", () => {
    const html = userDetails("en", unread);
    expect(html).not.toContain("First sign-in");
    expect(html).toContain("Synthetic learner");
  });
});

const task = (kind: string, extra: Partial<AdminTask> = {}): AdminTask => ({
  id: `${kind}:1`,
  kind,
  // An older server sends the general title; the console shows the approved one (D98).
  title: { en: "Review this task", fa: "بررسی این کار" },
  userIds: [],
  state: "open",
  createdAt: "2026-10-19T09:00:00.000Z",
  ...extra,
});

describe("tasks for a stopped deletion and a health alert (D96, D98)", () => {
  const tasksView = (locale: AdminLocale) =>
    renderToStaticMarkup(
      createElement(
        CoreScreens,
        screenProps({ view: "tasks", tasks: [task("privacy"), task("health")] }, "tasks", locale),
      ),
    );

  it("have their approved titles in English and Persian", () => {
    const en = tasksView("en");
    expect(en).toContain("Finish a stopped data deletion");
    expect(en).toContain("Review a system health alert");
    expect(en).not.toContain("Review this task");
    const fa = tasksView("fa");
    expect(fa).toContain("تکمیل حذف داده‌ای که متوقف شده است");
    expect(fa).toContain("بررسی هشدار سلامت سامانه");
    expect(fa).not.toContain("بررسی این کار");
  });

  it("open the Privacy view and the overview's System health card", () => {
    expect(taskDestination(task("privacy"))).toEqual({ view: "privacy" });
    expect(taskDestination(task("health"))).toEqual({ view: "overview" });
  });

  it("leave the other tasks' destinations unchanged", () => {
    expect(taskDestination(task("feedback", { threadId: "t1" }))).toEqual({
      view: "thread",
      id: "t1",
    });
    expect(taskDestination(task("email"))).toEqual({ view: "history" });
    expect(taskDestination(task("pilot_welcome", { userIds: ["u1"] }))).toEqual({
      compose: ["u1"],
    });
    expect(taskDestination(task("processing", { runId: "r1" }))).toEqual({
      view: "processing",
      id: "r1",
    });
    expect(taskDestination(task("unlisted"))).toEqual({ view: "users" });
  });
});
