"use client";

import { useEffect, useState } from "react";
import styles from "./Admin.module.css";
import type { AdminScreenProps, PanelMode } from "./AdminScreenProps";
import { adminQuery } from "./api";
import type { AdminLocale, AdminTask, AdminUser, PilotProgress, SystemHealth } from "./contracts";
import {
  errorMessage,
  localized,
  pilotProgressCopy,
  pilotProgressSteps,
  systemHealthCopy,
  systemHealthSize,
  taskTitle,
} from "./copy";
import { formatMegabytes, formatMoney, formatNumber, formatWait } from "./model";
import { ProcessingReviewDetails } from "./ProcessingReviewDetails";
import { Badge, Button, Empty, Field, Notice, Panel, Table } from "./primitives";

export function dateLabel(value: string | null | undefined, locale: "en" | "fa"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-gregory" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
/**
 * Where a task's main button leads. A stopped deletion (`privacy`) opens the Privacy view and a
 * health alert (`health`) the overview with its System health card (owner decision D98).
 */
export function taskDestination(
  task: AdminTask,
): { view: PanelMode; id?: string } | { compose: string[] } {
  if (task.threadId) return { view: "thread", id: task.threadId };
  if (
    task.kind === "email" ||
    /email_failed|email_unknown|failed_email|unknown_email/.test(task.kind)
  )
    return { view: "history" };
  if (/email|welcome|invitation|quota_updated|followup/.test(task.kind))
    return { compose: task.userIds };
  if (task.runId) return { view: "processing", id: task.runId };
  if (task.kind === "privacy") return { view: "privacy" };
  if (task.kind === "health") return { view: "overview" };
  return { view: "users" };
}
/** PRD-03 (D96, D98): the pilot step column labels, in step order. */
export function pilotProgressColumns(locale: AdminLocale): string[] {
  return pilotProgressSteps.map((step) => pilotProgressCopy.column[step][locale]);
}
/**
 * One cell per pilot step: the date in the panel's date format, "Not yet" before the step, or "—"
 * when no progress was read for the account. Dates only, never class content (PRD-03).
 */
export function PilotProgressCells({
  progress,
  locale,
}: {
  progress: PilotProgress | undefined;
  locale: AdminLocale;
}) {
  return (
    <>
      {pilotProgressSteps.map((step) => {
        const reached = progress?.[step];
        return (
          <td key={step}>
            {!progress
              ? "—"
              : reached
                ? dateLabel(reached, locale)
                : pilotProgressCopy.notYet[locale]}
          </td>
        );
      })}
    </>
  );
}
function TaskList(props: AdminScreenProps & { tasks: AdminTask[] }) {
  const { tasks, t, locale, compose, navigate, act, busy, reload } = props;
  const [editId, setEditId] = useState("");
  const [reason, setReason] = useState("");
  function open(task: AdminTask) {
    const destination = taskDestination(task);
    if ("compose" in destination) compose(destination.compose);
    else navigate(destination.view, destination.id);
  }
  return tasks.length ? (
    tasks.map((task) => (
      <div key={task.id}>
        <div className={styles.task}>
          <div>
            <strong>{taskTitle(task, locale)}</strong>
            {task.detail && <p className={styles.muted}>{localized(task.detail, locale)}</p>}
            <small className={styles.muted}>{dateLabel(task.createdAt, locale)}</small>
          </div>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <Button onClick={() => open(task)} primary>
              {task.runId
                ? t("Review and continue processing", "بررسی و ادامهٔ پردازش")
                : t("Take action", "رسیدگی")}
            </Button>
            <Button
              onClick={() => {
                setEditId(task.id);
                setReason("");
              }}
            >
              {t("Manage task", "تنظیم کار")}
            </Button>
          </div>
        </div>
        {editId === task.id && (
          <Notice>
            <Field label={t("Reason", "دلیل")}>
              <input
                className={styles.input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className={styles.actions}>
              {["deferred", "skipped", "done"].map((state) => (
                <Button
                  key={state}
                  disabled={busy || !reason.trim()}
                  onClick={() => {
                    void act(
                      "task.update",
                      {
                        taskId: task.id,
                        state: state === "deferred" ? "snoozed" : "dismissed",
                        ...(state === "deferred"
                          ? { snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() }
                          : {}),
                        reason,
                      },
                      t("Task updated.", "کار به‌روز شد."),
                    ).then((result) => {
                      if (result) {
                        setEditId("");
                        reload();
                      }
                    });
                  }}
                >
                  {state === "deferred"
                    ? t("Defer one day", "تعویق یک روز")
                    : state === "skipped"
                      ? t("Skip", "صرف‌نظر")
                      : t("Mark handled externally", "ثبت انجام خارج از پنل")}
                </Button>
              ))}
              <Button onClick={() => setEditId("")}>{t("Cancel", "انصراف")}</Button>
            </div>
          </Notice>
        )}
      </div>
    ))
  ) : (
    <Empty>
      {t(
        "No actions need your attention. New questions and missing welcome emails will appear here.",
        "کاری برای رسیدگی باقی نمانده است. پرسش‌های تازه و خوشامدگویی‌های انجام‌نشده اینجا دیده می‌شوند.",
      )}
    </Empty>
  );
}
function Users(props: AdminScreenProps) {
  const { data, t, locale, selected, setSelected, compose, navigate, search, setSearch } = props;
  const [query, setQuery] = useState(search);
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState<AdminUser[]>(data.users ?? []);
  const [cursor, setCursor] = useState(data.nextCursor);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  useEffect(() => {
    setRows(data.users ?? []);
    setCursor(data.nextCursor);
  }, [data.users, data.nextCursor]);
  const filtered = rows.filter(
    (user) =>
      filter === "all" ||
      (filter === "pilot" && user.pilot) ||
      (filter === "regular" && !user.pilot) ||
      (filter === "welcome" &&
        user.pilot &&
        user.welcomeState !== "sent" &&
        user.welcomeState !== "delivered"),
  );
  const allSelected = filtered.length > 0 && filtered.every((user) => selected.includes(user.id));
  function toggle(id: string) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  async function loadMore() {
    if (!cursor) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const snapshot = await adminQuery("users", { ...(search ? { search } : {}), cursor });
      setRows((current) => [
        ...current,
        ...(snapshot.users ?? []).filter((user) => !current.some((item) => item.id === user.id)),
      ]);
      setCursor(snapshot.nextCursor);
    } catch (failure) {
      setMoreError(failure);
    } finally {
      setMoreBusy(false);
    }
  }
  return (
    <>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
        }}
      >
        <Field label={t("Search name or email", "جست‌وجوی نام یا ایمیل")}>
          <input
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Button type="submit" primary>
          {t("Search", "جست‌وجو")}
        </Button>
        <Button onClick={() => navigate("pilot")}>{t("Pilot settings", "تنظیم پایلوت")}</Button>
      </form>
      <div className={styles.tabs}>
        {(
          [
            ["all", t("All users", "همهٔ کاربران")],
            ["pilot", t("Pilot", "پایلوت")],
            ["regular", t("Regular accounts", "حساب‌های عادی")],
            ["welcome", t("Welcome needed", "خوشامدگویی لازم")],
          ] as const
        ).map(([value, name]) => (
          <button
            key={value}
            type="button"
            className={styles.button}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {name}
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <div className={styles.selection}>
          <strong>
            {formatNumber(selected.length, locale)} {t("users selected", "کاربر انتخاب شده")}
          </strong>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <Button primary onClick={() => compose(selected)}>
              {t("Send email", "ارسال ایمیل")}
            </Button>
            <Button onClick={() => setSelected([])}>
              {t("Clear selection", "پاک‌کردن انتخاب")}
            </Button>
          </div>
        </div>
      )}
      <Panel title={t("Accounts", "حساب‌ها")}>
        {filtered.length ? (
          <Table
            columns={[
              t("Select", "انتخاب"),
              t("User", "کاربر"),
              t("Participation", "عضویت"),
              t("Allowance", "سهمیه"),
              t("Welcome", "خوشامدگویی"),
              ...pilotProgressColumns(locale),
              t("Action", "اقدام"),
            ]}
          >
            <tr>
              <td>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={allSelected}
                  aria-label={t("Select users shown in this list", "انتخاب کاربران نمایش‌داده‌شده")}
                  onChange={() =>
                    setSelected(
                      allSelected
                        ? selected.filter((id) => !filtered.some((user) => user.id === id))
                        : [...new Set([...selected, ...filtered.map((user) => user.id)])],
                    )
                  }
                />
              </td>
              <td colSpan={10}>
                <small className={styles.muted}>
                  {t(
                    "Selects only the accounts currently shown, including loaded pages.",
                    "فقط حساب‌های نمایش‌داده‌شده، از جمله صفحه‌های بارگذاری‌شده، انتخاب می‌شوند.",
                  )}
                </small>
              </td>
            </tr>
            {filtered.map((user) => (
              <tr key={user.id}>
                <td>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={selected.includes(user.id)}
                    aria-label={`${t("Select", "انتخاب")} ${user.name ?? user.email ?? user.id}`}
                    onChange={() => toggle(user.id)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => navigate("user", user.id)}
                  >
                    {user.name || t("Unnamed account", "حساب بدون نام")}
                  </button>
                  <br />
                  <bdi className={styles.muted}>{user.email ?? "—"}</bdi>
                </td>
                <td>{user.pilot ? t("Pilot", "پایلوت") : t("Regular account", "حساب عادی")}</td>
                <td>
                  <Badge state={user.quotaActive ? "active" : "inactive"} locale={locale} />
                </td>
                <td>
                  <Badge state={user.welcomeState} locale={locale} />
                </td>
                <PilotProgressCells progress={user.progress} locale={locale} />
                <td>
                  <Button onClick={() => compose([user.id])}>
                    {t("Send email", "ارسال ایمیل")}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{t("No users match these filters.", "کاربری با این فیلترها پیدا نشد.")}</Empty>
        )}
        {moreError !== null && <Notice error>{errorMessage(moreError, locale)}</Notice>}
        {cursor && (
          <div className={styles.actions}>
            <Button
              disabled={moreBusy}
              onClick={() => {
                void loadMore();
              }}
            >
              {t("Load more users", "کاربران بیشتر")}
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
function Processing(props: AdminScreenProps) {
  const { data, t, locale, act, busy, reload, compose, navigate } = props;
  const [runId, setRunId] = useState("");
  const [reason, setReason] = useState("");
  const runs = data.runs ?? [];
  return (
    <>
      {props.runId && runs[0] ? <ProcessingReviewDetails run={runs[0]} props={props} /> : null}
      <Panel title={t("Processing runs", "پردازش‌ها")}>
        {runs.length ? (
          <Table
            columns={[
              t("Session", "کلاس"),
              t("Stage", "مرحله"),
              t("Status", "وضعیت"),
              t("Model", "مدل"),
              t("Action", "اقدام"),
            ]}
          >
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  {run.title || t("Session processing", "پردازش کلاس")}
                  <br />
                  <small className={styles.muted}>{dateLabel(run.createdAt, locale)}</small>
                </td>
                <td>
                  <bdi>{run.stage}</bdi>
                </td>
                <td>
                  <Badge state={run.state} locale={locale} />
                  {run.lastError && (
                    <small className={styles.muted} style={{ display: "block" }}>
                      <bdi>{run.lastError}</bdi>
                    </small>
                  )}
                </td>
                <td>
                  <bdi>{run.model ?? "—"}</bdi>
                </td>
                <td>
                  <div className={styles.actions} style={{ marginTop: 0 }}>
                    <Button onClick={() => compose([run.userId])}>
                      {t("Contact user", "تماس با کاربر")}
                    </Button>
                    {!props.runId && run.kind === "class" ? (
                      <Button onClick={() => navigate("processing", run.id)}>
                        {t("Review and continue processing", "بررسی و ادامهٔ پردازش")}
                      </Button>
                    ) : null}
                    {run.retryAllowed && (
                      <Button
                        onClick={() => {
                          setRunId(run.id);
                          setReason("");
                        }}
                      >
                        {t("Review and continue processing", "بررسی و ادامهٔ پردازش")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{t("No processing runs to show.", "پردازشی برای نمایش وجود ندارد.")}</Empty>
        )}
      </Panel>
      {runId && (
        <Panel
          title={`${t("Continue processing", "ادامهٔ پردازش")} · ${runs.find((run) => run.id === runId)?.title ?? runId}`}
        >
          <Notice>
            {t(
              "Only the permitted failed stage is retried. Existing results and usage are preserved. The server checks sources, unresolved charges and budget before starting.",
              "فقط مرحلهٔ ناموفق مجاز تکرار می‌شود. نتیجه‌ها و مصرف قبلی حفظ می‌شوند. سرور منبع، هزینهٔ نامعلوم و بودجه را پیش از شروع بررسی می‌کند.",
            )}
          </Notice>
          <Field label={t("Reason", "دلیل")}>
            <input
              className={styles.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              primary
              disabled={busy || !reason.trim()}
              onClick={() => {
                void act(
                  "job.retry",
                  { runId, reason },
                  t("Retry request recorded.", "درخواست تلاش مجدد ثبت شد."),
                ).then((result) => {
                  if (result) {
                    setRunId("");
                    if (result.runId) navigate("processing", result.runId);
                    reload();
                  }
                });
              }}
            >
              {t("Confirm retry", "تأیید تلاش مجدد")}
            </Button>
            <Button onClick={() => setRunId("")}>{t("Cancel", "انصراف")}</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
/**
 * OPS-02 (ADM-01, ADM-12): the hourly health check's signals, read when the overview loads. Counts
 * and times only (packages/core/src/ops/health.ts); the texts are the owner's approved copy (D97).
 */
export function SystemHealthCard({
  health,
  locale,
}: {
  health: SystemHealth;
  locale: AdminLocale;
}) {
  const copy = systemHealthCopy;
  // Measured against the server's check time, so the browser's clock does not change it.
  const wait =
    health.oldestQueuedAt === null
      ? Number.NaN
      : Date.parse(health.checkedAt) - Date.parse(health.oldestQueuedAt);
  const rows: Array<[string, string]> = [
    [
      copy.databaseSize[locale],
      systemHealthSize(
        formatMegabytes(health.databaseBytes, locale),
        formatMegabytes(health.databaseBytesLimit, locale),
        locale,
      ),
    ],
    [copy.failedJobs[locale], formatNumber(health.failedJobsLastHour, locale)],
    [copy.queueWait[locale], Number.isFinite(wait) ? formatWait(wait, locale) : "—"],
    [copy.lastRunner[locale], dateLabel(health.lastRunnerAt, locale)],
    [copy.schema[locale], copy.schemaState[health.schema?.state ?? "unknown"][locale]],
  ];
  return (
    <Panel title={copy.title[locale]}>
      {health.alerts.length ? (
        health.alerts.map((condition) => (
          <Notice key={condition} warning>
            {copy.alert[condition][locale]}
          </Notice>
        ))
      ) : (
        <p className={styles.muted}>{copy.noAlert[locale]}</p>
      )}
      {rows.map(([label, value]) => (
        <div key={label} className={styles.task}>
          <strong>{label}</strong>
          <span>{value}</span>
        </div>
      ))}
    </Panel>
  );
}
export function CoreScreens(props: AdminScreenProps) {
  const { data, mode, t, locale, navigate } = props;
  if (mode === "users") return <Users {...props} />;
  if (mode === "processing") return <Processing {...props} />;
  if (mode === "tasks")
    return (
      <Panel title={t("Needs your attention", "نیازمند رسیدگی")}>
        <TaskList {...props} tasks={data.tasks ?? []} />
      </Panel>
    );
  if (mode !== "overview") return null;
  return (
    <>
      <Panel title={t("Things to take care of", "کارهای نیازمند رسیدگی")} hero>
        <TaskList {...props} tasks={(data.tasks ?? []).slice(0, 4)} />
        <div className={styles.actions}>
          <Button onClick={() => navigate("tasks")}>{t("All tasks", "همهٔ کارها")}</Button>
        </div>
      </Panel>
      <div className={`${styles.grid} ${styles.metrics}`}>
        <Panel title={t("Pilot participants", "شرکت‌کنندگان پایلوت")}>
          <div className={styles.metric}>
            <bdi>
              {data.pilot
                ? `${formatNumber(data.pilot.admitted, locale)} / ${formatNumber(data.pilot.capacity, locale)}`
                : "—"}
            </bdi>
          </div>
          <p className={styles.muted}>
            {data.pilot
              ? `${formatNumber(data.pilot.active, locale)} ${t("active allowances", "سهمیهٔ فعال")}`
              : t("Pilot data is unavailable.", "دادهٔ پایلوت در دسترس نیست.")}
          </p>
          <Button onClick={() => navigate("pilot")}>{t("Manage pilot", "مدیریت پایلوت")}</Button>
        </Panel>
        <Panel title={t("Actual AI cost", "هزینهٔ قطعی AI")}>
          <div className={styles.metric}>
            <bdi>{data.costs ? formatMoney(data.costs.actualMicros, locale) : "—"}</bdi>
          </div>
          <p className={styles.muted}>
            {t("This month, UTC", "این ماه، UTC")}
            {data.costs && (
              <>
                {" "}
                · <bdi>{formatMoney(data.costs.limits.systemMonth, locale)}</bdi>{" "}
                {t("budget", "بودجه")}
              </>
            )}
          </p>
          <Button onClick={() => navigate("costs")}>{t("Review costs", "بررسی هزینه")}</Button>
        </Panel>
        <Panel title={t("In the queue", "در صف")}>
          <div className={styles.metric}>
            {data.counts ? formatNumber(data.counts.queuedRuns, locale) : "—"}
          </div>
          <p className={styles.muted}>
            {t("Processing runs awaiting work", "پردازش‌های در انتظار اجرا")}
          </p>
          <Button onClick={() => navigate("processing")}>
            {t("View processing", "دیدن پردازش‌ها")}
          </Button>
        </Panel>
      </div>
      {data.health && <SystemHealthCard health={data.health} locale={locale} />}
      <Panel title={t("Recent activity", "فعالیت‌های اخیر")}>
        {data.audit?.length ? (
          <Table columns={[t("Action", "اقدام"), t("Reason", "دلیل"), t("Time", "زمان")]}>
            {data.audit.slice(0, 6).map((item) => (
              <tr key={item.id}>
                <td>
                  <bdi>{item.action}</bdi>
                </td>
                <td>{item.reason ?? "—"}</td>
                <td>{dateLabel(item.createdAt, locale)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{t("No activity has been recorded yet.", "هنوز فعالیتی ثبت نشده است.")}</Empty>
        )}
        <div className={styles.actions}>
          <Button onClick={() => navigate("audit")}>{t("Activity history", "سابقهٔ فعالیت")}</Button>
        </div>
      </Panel>
    </>
  );
}
