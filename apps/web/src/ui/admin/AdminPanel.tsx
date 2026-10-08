"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconComponent } from "../components/Icon";
import { Cards, CircleDashed, CircleHalf, FileText, Queue, UserCircle } from "../icons";
import styles from "./Admin.module.css";
import type { AdminScreenProps, PanelMode } from "./AdminScreenProps";
import {
  AdminRequestError,
  adminAction,
  adminQuery,
  releaseSubmissionKey,
  submissionKey,
} from "./api";
import { CommunicationScreens } from "./CommunicationScreens";
import { CoreScreens } from "./CoreScreens";
import type { AdminLocale, AdminResult, AdminSnapshot, AdminView } from "./contracts";
import { errorMessage, viewNames } from "./copy";
import { Button } from "./primitives";
import { QuotaScreens } from "./QuotaScreens";
import { SystemScreens } from "./SystemScreens";

const nav: { view: AdminView; en: string; fa: string; icon: IconComponent }[] = [
  { view: "overview", en: "Overview", fa: "نمای کلی", icon: Cards },
  { view: "users", en: "Users", fa: "کاربران", icon: UserCircle },
  { view: "feedback", en: "Messages", fa: "پیام‌ها", icon: FileText },
  { view: "costs", en: "Usage & costs", fa: "مصرف و هزینه", icon: CircleDashed },
  { view: "processing", en: "Processing", fa: "پردازش‌ها", icon: Queue },
  { view: "settings", en: "Settings", fa: "تنظیمات", icon: CircleHalf },
];
const allViews = new Set([...Object.keys(viewNames), "compose"]);
function activeNav(mode: PanelMode): AdminView {
  if (["users", "user", "pilot"].includes(mode)) return "users";
  if (["feedback", "thread", "templates", "history", "compose"].includes(mode)) return "feedback";
  if (["costs", "rates"].includes(mode)) return "costs";
  if (["settings", "privacy", "backups", "audit"].includes(mode)) return "settings";
  return mode === "processing" ? "processing" : "overview";
}

export function AdminPanel() {
  const [locale, setLocale] = useState<AdminLocale>("en");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [mode, setMode] = useState<PanelMode>("overview");
  const [userId, setUserId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [runId, setRunId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const [revision, setRevision] = useState(0);
  const keyHolder = useRef(new Map<string, string>());
  const mainRef = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const localeTouched = useRef(false);
  const themeTouched = useRef(false);
  const currentQuery = useRef("");
  const t = (en: string, fa: string) => (locale === "fa" ? fa : en);
  function localeChange(value: AdminLocale) {
    localeTouched.current = true;
    setLocale(value);
    setAnnouncement("");
  }
  function themeChange(value: "system" | "light" | "dark") {
    themeTouched.current = true;
    setTheme(value);
  }
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("recalino.admin.locale");
      if (saved === "fa" || saved === "en") {
        localeTouched.current = true;
        setLocale(saved);
      }
    } catch {
      /* Preference persistence is optional. */
    }
    const readHash = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const view = params.get("view");
      if (!view || !allViews.has(view)) return;
      setMode(view as PanelMode);
      setUserId(params.get("userId") ?? "");
      setThreadId(params.get("threadId") ?? "");
      setRunId(params.get("runId") ?? "");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    adminQuery("settings", {}, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted || !snapshot.settings) return;
        if (!localeTouched.current) setLocale(snapshot.settings.language);
        if (!themeTouched.current) setTheme(snapshot.settings.theme);
        initialized.current = true;
      })
      .catch(() => {
        /* Preferences are optional; the settings view reports retrieval failures. */
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const previousLang = root.lang;
    const previousDir = root.dir;
    root.lang = locale;
    root.dir = locale === "fa" ? "rtl" : "ltr";
    try {
      localStorage.setItem("recalino.admin.locale", locale);
    } catch {
      /* Preference persistence is optional. */
    }
    return () => {
      root.lang = previousLang;
      root.dir = previousDir;
    };
  }, [locale]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const previousTheme = document.documentElement.getAttribute("data-theme");
    const apply = () =>
      document.documentElement.setAttribute(
        "data-theme",
        theme === "system" ? (media.matches ? "dark" : "light") : theme,
      );
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      if (previousTheme) document.documentElement.setAttribute("data-theme", previousTheme);
    };
  }, [theme]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh token.
  useEffect(() => {
    const controller = new AbortController();
    const view = mode === "compose" ? "templates" : mode;
    const params: Record<string, string> = {};
    if (userId) params.userId = userId;
    if (threadId) params.threadId = threadId;
    if (runId && (view === "processing" || view === "costs")) params.runId = runId;
    if (view === "users" && search) params.search = search;
    const queryKey = JSON.stringify({ view, params });
    setLoading(true);
    setError(null);
    if (currentQuery.current !== queryKey) setData(null);
    currentQuery.current = queryKey;
    adminQuery(view, params, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setData(snapshot);
        setLoading(false);
        if (snapshot.settings && !initialized.current) {
          initialized.current = true;
          if (!localeTouched.current) setLocale(snapshot.settings.language);
          if (!themeTouched.current) setTheme(snapshot.settings.theme);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [mode, userId, threadId, runId, search, revision]);

  function navigate(view: PanelMode, id?: string) {
    setMode(view);
    if (view === "user") setUserId(id ?? "");
    else setUserId("");
    if (view === "thread") setThreadId(id ?? "");
    else setThreadId("");
    const targetRun = view === "processing" || view === "costs" ? (id ?? "") : "";
    setRunId(targetRun);
    setAnnouncement("");
    setError(null);
    const hash = new URLSearchParams({ view });
    if (view === "user" && id) hash.set("userId", id);
    if (view === "thread" && id) hash.set("threadId", id);
    if (targetRun) hash.set("runId", targetRun);
    history.pushState(null, "", `#${hash}`);
    mainRef.current?.focus();
  }
  function compose(ids: string[]) {
    setSelected(ids);
    navigate("compose");
  }
  async function act(
    action: string,
    input: unknown,
    success?: string,
    onValidation?: (fields: Record<string, string[]>) => boolean,
  ): Promise<AdminResult | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setAnnouncement("");
    try {
      const result = await adminAction(action, input, submissionKey(keyHolder, action, input));
      // Successful completion ends this intent; network-failed retries retain the original key.
      releaseSubmissionKey(keyHolder, action, input);
      setAnnouncement(success ?? "");
      return result;
    } catch (failure) {
      if (
        !(
          failure instanceof AdminRequestError &&
          failure.code === "validation_failed" &&
          onValidation?.(failure.fields)
        )
      )
        setError(failure);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const matchingData =
    data?.view === (mode === "compose" ? "templates" : mode) &&
    (mode !== "user" || data.user?.id === userId) &&
    (mode !== "thread" || data.thread?.id === threadId);
  const props: AdminScreenProps | null =
    data && matchingData
      ? {
          data,
          locale,
          t,
          mode,
          userId,
          threadId,
          runId,
          selected,
          setSelected,
          navigate,
          compose,
          act,
          busy: busy || loading,
          search,
          setSearch,
          reload,
          localeChange,
          theme,
          themeChange,
        }
      : null;
  return (
    <div className={styles.shell} lang={locale} dir={locale === "fa" ? "rtl" : "ltr"}>
      <a href="#admin-content" className={`${styles.skip} ${styles.button}`}>
        {t("Skip to content", "رفتن به محتوا")}
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brand} dir="ltr">
          Recalino
          <small dir={locale === "fa" ? "rtl" : "ltr"}>{t("Administration", "مدیریت")}</small>
        </div>
        <nav className={styles.nav} aria-label={t("Admin navigation", "ناوبری مدیریت")}>
          {nav.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-current={activeNav(mode) === item.view ? "page" : undefined}
              onClick={() => navigate(item.view)}
            >
              <Icon icon={item.icon} className={styles.navIcon} />
              {t(item.en, item.fa)}
            </button>
          ))}
        </nav>
        <div className={styles.sideFooter}>
          <span className={styles.badge}>{t("Main administrator", "مدیر اصلی")}</span>
          <Button onClick={() => localeChange(locale === "fa" ? "en" : "fa")}>
            {locale === "fa" ? "English" : "فارسی"}
          </Button>
          <Link href="/today" className={styles.link}>
            {t("Open learning app", "بازکردن اپ یادگیری")}
          </Link>
        </div>
      </aside>
      <main id="admin-content" tabIndex={-1} ref={mainRef} className={styles.content}>
        <div className={styles.topbar}>
          <span className={styles.eyebrow}>
            {t("Your workspace, clearly organised.", "فضای کار شما، روشن و مرتب.")}
          </span>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <Button onClick={() => localeChange(locale === "fa" ? "en" : "fa")}>
              {locale === "fa" ? "English" : "فارسی"}
            </Button>
            <Button onClick={reload} disabled={loading || busy}>
              {t("Refresh", "تازه‌سازی")}
            </Button>
          </div>
        </div>
        <header className={styles.header}>
          <h1>
            {mode === "compose" ? t("Write an email", "نوشتن ایمیل") : viewNames[mode][locale]}
          </h1>
          <p>
            {t(
              "Review changes before approving. Your drafts stay yours.",
              "تغییرها را پیش از تأیید بررسی کنید. پیش‌نویس‌های شما حفظ می‌شوند.",
            )}
          </p>
        </header>
        {error !== null && (
          <div role="alert" className={`${styles.notice} ${styles.error}`}>
            {errorMessage(error, locale)}
            <div className={styles.actions}>
              <Button
                onClick={() => {
                  setError(null);
                  reload();
                }}
              >
                {t("Reload data", "بارگذاری دوبارهٔ داده")}
              </Button>
            </div>
          </div>
        )}
        <div role="status" aria-live="polite">
          {announcement && <div className={styles.notice}>{announcement}</div>}
        </div>
        {loading && (
          <div className={styles.loading} role="status">
            <span className={styles.loader} aria-hidden="true" />
            {t("Loading your workspace…", "در حال بارگذاری فضای کار…")}
          </div>
        )}
        {props && (
          <>
            <CoreScreens {...props} />
            <QuotaScreens {...props} />
            <CommunicationScreens {...props} />
            <SystemScreens {...props} />
          </>
        )}
      </main>
    </div>
  );
}
