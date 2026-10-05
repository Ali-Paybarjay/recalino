"use client";

import { useState } from "react";
import styles from "./Admin.module.css";
import type { AdminScreenProps } from "./AdminScreenProps";
import { dateLabel } from "./CoreScreens";
import { Badge, Button, Empty, Field, Notice, Panel, Table } from "./primitives";

function Settings(props: AdminScreenProps) {
  const { data, t, locale, localeChange, theme, themeChange, navigate, act, busy } = props;
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Panel title={t("Workspace preferences", "ترجیحات پنل")}>
        <div className={styles.split}>
          <Field
            label={t("Interface language", "زبان رابط")}
            help={t(
              "Email language and written drafts are independent.",
              "زبان ایمیل و متن پیش‌نویس‌ها مستقل‌اند.",
            )}
          >
            <select
              className={styles.select}
              value={locale}
              onChange={(e) => {
                localeChange(e.target.value as "en" | "fa");
                setSaved(false);
              }}
            >
              <option value="en">English</option>
              <option value="fa">فارسی</option>
            </select>
          </Field>
          <Field label={t("Appearance", "ظاهر")}>
            <select
              className={styles.select}
              value={theme}
              onChange={(e) => {
                themeChange(e.target.value as "system" | "light" | "dark");
                setSaved(false);
              }}
            >
              <option value="system">{t("Follow system", "مطابق دستگاه")}</option>
              <option value="light">{t("Light", "روشن")}</option>
              <option value="dark">{t("Dark", "تیره")}</option>
            </select>
          </Field>
        </div>
        <Button
          primary
          disabled={busy}
          onClick={() => {
            void act(
              "settings.save",
              { language: locale, theme },
              t("Preferences saved.", "ترجیحات ذخیره شد."),
            ).then((result) => {
              if (result) setSaved(true);
            });
          }}
        >
          {t("Save preferences", "ذخیرهٔ ترجیحات")}
        </Button>
        {saved && (
          <p className={styles.help}>
            {t(
              "These preferences apply to the administrator account.",
              "این ترجیحات به حساب مدیر اعمال می‌شوند.",
            )}
          </p>
        )}
      </Panel>
      <Panel title={t("Service readiness", "آمادگی سرویس‌ها")}>
        {data.settings ? (
          <>
            <Table
              columns={[t("Service", "سرویس"), t("Status", "وضعیت"), t("Configuration", "تنظیمات")]}
            >
              <tr>
                <td>{t("Email delivery", "ارسال ایمیل")}</td>
                <td>
                  <Badge
                    locale={locale}
                    state={data.settings.senderConfigured ? "ready" : "inactive"}
                  />
                </td>
                <td>
                  <bdi>{data.settings.senderEmail ?? "—"}</bdi>
                </td>
              </tr>
              <tr>
                <td>{t("Reply address", "نشانی پاسخ")}</td>
                <td>—</td>
                <td>
                  <bdi>{data.settings.replyTo ?? "—"}</bdi>
                </td>
              </tr>
              <tr>
                <td>{t("Application link", "لینک اپ")}</td>
                <td>—</td>
                <td className={styles.wrap}>
                  <bdi>{data.settings.appLink ?? "—"}</bdi>
                </td>
              </tr>
              <tr>
                <td>{t("AI processing", "پردازش AI")}</td>
                <td>
                  <Badge
                    locale={locale}
                    state={data.settings.aiConfigured ? "ready" : "inactive"}
                  />
                </td>
                <td>
                  {t("Credentials are kept on the server.", "کلیدها روی سرور نگهداری می‌شوند.")}
                </td>
              </tr>
            </Table>
            {!data.settings.senderConfigured && (
              <Notice warning>
                {t(
                  "Email delivery needs a verified sender and secure provider configuration. Drafts and previews can still be prepared; delivery status is shown honestly.",
                  "ارسال ایمیل به فرستندهٔ تأییدشده و تنظیم امن سرویس نیاز دارد. پیش‌نویس و پیش‌نمایش آماده می‌شوند و وضعیت تحویل دقیق نمایش داده می‌شود.",
                )}
              </Notice>
            )}
          </>
        ) : (
          <Empty>
            {t(
              "Service configuration is unavailable. Refresh to check it.",
              "تنظیمات سرویس در دسترس نیست. برای بررسی تازه‌سازی کنید.",
            )}
          </Empty>
        )}
      </Panel>
      <Panel title={t("Operations", "عملیات")}>
        {[
          ["pilot", t("Pilot capacity", "ظرفیت پایلوت")],
          ["rates", t("API estimates & models", "برآورد API و مدل‌ها")],
          ["privacy", t("Privacy & storage", "حریم خصوصی و فایل‌ها")],
          ["backups", t("Backups", "پشتیبان‌ها")],
          ["audit", t("Activity history", "سابقهٔ فعالیت")],
        ].map(([view, label]) => (
          <div className={styles.task} key={view}>
            <strong>{label}</strong>
            <Button
              onClick={() => navigate(view as "pilot" | "rates" | "privacy" | "backups" | "audit")}
            >
              {t("Open", "بازکردن")}
            </Button>
          </div>
        ))}
      </Panel>
    </>
  );
}
export function SystemScreens(props: AdminScreenProps) {
  const { data, t, locale, mode } = props;
  if (mode === "settings") return <Settings {...props} />;
  if (mode === "audit")
    return (
      <Panel title={t("Administrator activity", "فعالیت مدیر")}>
        {data.audit?.length ? (
          <Table
            columns={[
              t("Action", "اقدام"),
              t("Administrator", "مدیر"),
              t("Reason", "دلیل"),
              t("Time", "زمان"),
            ]}
          >
            {data.audit.map((item) => (
              <tr key={item.id}>
                <td>
                  <bdi>{item.action}</bdi>
                </td>
                <td>
                  <bdi>{item.actorId}</bdi>
                </td>
                <td dir="auto">{item.reason ?? "—"}</td>
                <td>{dateLabel(item.createdAt, locale)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{t("No activity is recorded.", "فعالیتی ثبت نشده است.")}</Empty>
        )}
        <p className={styles.help}>
          {t(
            "Financial changes, access, approved messages and settings keep an audit record.",
            "تغییرهای مالی، دسترسی، پیام‌های تأییدشده و تنظیمات سابقه دارند.",
          )}
        </p>
      </Panel>
    );
  if (mode === "privacy")
    return (
      <>
        <Panel title={t("Deletion & cleanup requests", "درخواست‌های حذف و پاک‌سازی")}>
          {data.privacy?.length ? (
            <Table
              columns={[
                t("Request", "درخواست"),
                t("Type", "نوع"),
                t("Status", "وضعیت"),
                t("Created", "زمان ثبت"),
              ]}
            >
              {data.privacy.map((item) => (
                <tr key={item.id}>
                  <td>
                    <bdi>{item.id}</bdi>
                  </td>
                  <td>
                    {item.kind === "account"
                      ? t("Account deletion", "حذف حساب")
                      : item.kind === "session"
                        ? t("Class deletion", "حذف کلاس")
                        : item.kind === "source"
                          ? t("Source deletion", "حذف منبع")
                          : t("Cleanup request", "درخواست پاک‌سازی")}
                  </td>
                  <td>
                    <Badge state={item.state} locale={locale} />
                    {item.lastError && (
                      <small className={styles.muted}>
                        <bdi>{item.lastError}</bdi>
                      </small>
                    )}
                  </td>
                  <td>{dateLabel(item.createdAt, locale)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>
              {t(
                "No deletion or cleanup requests to show.",
                "درخواست حذف یا پاک‌سازی برای نمایش وجود ندارد.",
              )}
            </Empty>
          )}
        </Panel>
        <Notice>
          {t(
            "Private class content is not shown in routine admin views. Support access requires a reason, limited scope and an audit record.",
            "محتوای خصوصی کلاس در صفحه‌های معمول مدیریت نمایش داده نمی‌شود. دسترسی پشتیبانی به دلیل، دامنهٔ محدود و سابقه نیاز دارد.",
          )}
        </Notice>
      </>
    );
  if (mode === "backups")
    return (
      <>
        <Panel title={t("Backup history", "تاریخچهٔ پشتیبان")}>
          {data.backups?.length ? (
            <Table
              columns={[
                t("Backup", "پشتیبان"),
                t("Status", "وضعیت"),
                t("Verified", "تأیید"),
                t("Restore drill", "آزمون بازیابی"),
              ]}
            >
              {data.backups.map((item) => (
                <tr key={item.id}>
                  <td>{dateLabel(item.createdAt, locale)}</td>
                  <td>
                    <Badge state={item.state} locale={locale} />
                    {item.lastError && (
                      <small className={styles.muted}>
                        <bdi>{item.lastError}</bdi>
                      </small>
                    )}
                  </td>
                  <td>{dateLabel(item.verifiedAt, locale)}</td>
                  <td>{dateLabel(item.restoreDrillAt, locale)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>
              {t("No backup metadata has been recorded.", "اطلاعات پشتیبانی ثبت نشده است.")}
            </Empty>
          )}
        </Panel>
        <Notice>
          {t(
            "Recovery uses the verified procedure in an isolated environment. This history reports recorded results; it does not assume a successful recovery.",
            "بازیابی با روش تأییدشده در محیط ایزوله انجام می‌شود. این سابقه نتیجهٔ ثبت‌شده را نشان می‌دهد و موفقیت بازیابی را فرض نمی‌کند.",
          )}
        </Notice>
      </>
    );
  return null;
}
