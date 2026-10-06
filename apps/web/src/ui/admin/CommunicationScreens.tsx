"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Admin.module.css";
import type { AdminScreenProps } from "./AdminScreenProps";
import { dateLabel } from "./CoreScreens";
import type {
  AdminEmail,
  AdminLocale,
  AdminResult,
  EmailPresentationPreview,
  EmailPresentationSettings,
  EmailPreview,
  EmailTemplate,
} from "./contracts";
import {
  emailBodyWithNote,
  formatNumber,
  manualTemplateVariables,
  readableTemplateText,
} from "./model";
import { Badge, Button, Empty, Field, Notice, Panel, Table } from "./primitives";

function presentationInput(value: EmailPresentationSettings): EmailPresentationSettings {
  return {
    ...(value.headline?.trim() ? { headline: value.headline.trim() } : {}),
    ...(value.preheader?.trim() ? { preheader: value.preheader.trim() } : {}),
    action: value.action
      ? { label: value.action.label.trim(), url: value.action.url.trim() }
      : null,
  };
}
function templatePresentation(
  template: EmailTemplate | undefined,
  language: AdminLocale,
): EmailPresentationSettings {
  if (template?.presentation?.[language]) return template.presentation[language];
  if (!template || template.id === "service_notice") return { action: null };
  const conversation = [
    "feedback_thanks",
    "support_reply",
    "pilot_followup",
    "pilot_complete",
  ].includes(template.id);
  return {
    action: {
      label: conversation
        ? language === "fa"
          ? "مشاهدهٔ گفت‌وگو"
          : "View conversation"
        : language === "fa"
          ? "ورود به ریکالینو"
          : "Open Recalino",
      url: conversation ? "{{conversation_link}}" : "{{app_link}}",
    },
  };
}
function validPresentation(value: EmailPresentationSettings): boolean {
  if (!value.action) return true;
  if (!value.action.label.trim()) return false;
  if (/^{{\s*(app_link|conversation_link)\s*}}(?:\/[\w/?#=.&%-]*)?$/.test(value.action.url.trim()))
    return true;
  try {
    const url = new URL(value.action.url.trim());
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !Array.from(value.action.url.trim()).some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
      )
    );
  } catch {
    return false;
  }
}
function PresentationFields({
  value,
  onChange,
  language,
  t,
  busy,
  problem,
}: {
  value: EmailPresentationSettings;
  onChange: (value: EmailPresentationSettings) => void;
  language: AdminLocale;
  t: AdminScreenProps["t"];
  busy: boolean;
  problem?: "actionLabel" | "actionUrl";
}) {
  return (
    <div className={styles.emailDesignFields}>
      <h3>{t("Email appearance", "ظاهر ایمیل")}</h3>
      <p className={styles.help}>
        {t(
          "The Recalino logo, colours and footer are included automatically. The final design is shown before approval.",
          "لوگو، رنگ‌ها و امضای ریکالینو خودکار اضافه می‌شوند. طرح نهایی پیش از تأیید نمایش داده می‌شود.",
        )}
      </p>
      <div className={styles.split}>
        <Field
          label={t("Email heading (optional)", "عنوان داخل ایمیل (اختیاری)")}
          help={t("Uses the subject when empty.", "اگر خالی باشد، موضوع استفاده می‌شود.")}
        >
          <input
            className={styles.input}
            disabled={busy}
            maxLength={300}
            lang={language}
            dir={language === "fa" ? "rtl" : "ltr"}
            value={value.headline ?? ""}
            onChange={(event) => onChange({ ...value, headline: event.target.value })}
          />
        </Field>
        <Field label={t("Inbox preview line (optional)", "خط پیش‌نمایش صندوق ایمیل (اختیاری)")}>
          <input
            className={styles.input}
            disabled={busy}
            maxLength={200}
            lang={language}
            dir={language === "fa" ? "rtl" : "ltr"}
            value={value.preheader ?? ""}
            onChange={(event) => onChange({ ...value, preheader: event.target.value })}
          />
        </Field>
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          className={styles.check}
          disabled={busy}
          checked={Boolean(value.action)}
          onChange={(event) =>
            onChange({
              ...value,
              action: event.target.checked
                ? {
                    label: language === "fa" ? "ورود به ریکالینو" : "Open Recalino",
                    url: "{{app_link}}",
                  }
                : null,
            })
          }
        />
        {t("Include an action button", "افزودن دکمهٔ اقدام")}
      </label>
      {value.action && (
        <div className={styles.split}>
          <Field
            label={t("Button text", "متن دکمه")}
            help={
              problem === "actionLabel"
                ? t("Enter the button text.", "متن دکمه را وارد کنید.")
                : undefined
            }
          >
            <input
              className={styles.input}
              disabled={busy}
              maxLength={100}
              lang={language}
              dir={language === "fa" ? "rtl" : "ltr"}
              value={value.action.label}
              data-compose-field="actionLabel"
              aria-invalid={problem === "actionLabel" || undefined}
              onChange={(event) =>
                onChange({
                  ...value,
                  action: { label: event.target.value, url: value.action?.url ?? "" },
                })
              }
            />
          </Field>
          <Field
            label={t("Button link", "لینک دکمه")}
            help={t(
              problem === "actionUrl"
                ? "Use a complete HTTPS link, or keep the automatic app link."
                : "The app link is filled automatically. You can use a different HTTPS link.",
              problem === "actionUrl"
                ? "لینک کامل HTTPS وارد کنید یا لینک خودکار اپ را نگه دارید."
                : "لینک اپ خودکار تکمیل می‌شود. می‌توانید لینک HTTPS دیگری وارد کنید.",
            )}
          >
            <input
              className={styles.input}
              disabled={busy}
              maxLength={2000}
              dir="ltr"
              value={value.action.url}
              data-compose-field="actionUrl"
              aria-invalid={problem === "actionUrl" || undefined}
              onChange={(event) =>
                onChange({
                  ...value,
                  action: { label: value.action?.label ?? "", url: event.target.value },
                })
              }
            />
          </Field>
        </div>
      )}
    </div>
  );
}
function BrandedPreview({
  presentation,
  body,
  language,
  t,
}: {
  presentation?: EmailPresentationPreview | null;
  body: string;
  language: AdminLocale;
  t: AdminScreenProps["t"];
}) {
  const [mode, setMode] = useState<"desktop" | "mobile" | "text">("desktop");
  return (
    <div className={styles.emailPreview}>
      {presentation && (
        <div className={styles.tabs}>
          {(
            [
              ["desktop", t("Desktop preview", "پیش‌نمایش دسکتاپ")],
              ["mobile", t("Mobile preview", "پیش‌نمایش موبایل")],
              ["text", t("Plain text", "متن ساده")],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={styles.button}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {presentation && mode !== "text" ? (
        <div
          className={`${styles.emailPreviewCanvas} ${mode === "mobile" ? styles.emailPreviewMobile : ""}`}
        >
          <iframe
            title={t("Approved email design preview", "پیش‌نمایش طرح ایمیل برای تأیید")}
            className={styles.emailPreviewFrame}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={presentation.previewHtml}
          />
        </div>
      ) : (
        <div className={styles.emailBody} lang={language} dir="auto">
          {presentation?.text ?? body}
        </div>
      )}
      <p className={styles.help}>
        {presentation
          ? t(
              "This is the saved design for this recipient. Images, spacing and fonts may vary slightly between email apps. Buttons are inactive in the preview.",
              "این طرح ذخیره‌شده برای همین گیرنده است. تصویر، فاصله و فونت ممکن است در برنامه‌های ایمیل کمی متفاوت باشند. دکمه‌ها در پیش‌نمایش غیرفعال‌اند.",
            )
          : t("This saved message uses plain text.", "این پیام ذخیره‌شده به‌صورت متن ساده است.")}
      </p>
    </div>
  );
}

function MessageTabs({ props, active }: { props: AdminScreenProps; active: string }) {
  const { t, navigate } = props;
  return (
    <div className={styles.tabs}>
      {[
        ["feedback", t("Feedback inbox", "صندوق بازخورد")],
        ["templates", t("Email templates", "قالب‌های ایمیل")],
        ["history", t("Email history", "تاریخچهٔ ایمیل")],
      ].map(([value, label]) => (
        <button
          type="button"
          key={value}
          className={styles.button}
          aria-pressed={active === value}
          onClick={() => navigate(value as "feedback" | "templates" | "history")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function EmailRows({ rows, props }: { rows: AdminEmail[]; props: AdminScreenProps }) {
  const { t, locale, act, busy, reload } = props;
  const [retry, setRetry] = useState<string | null>(null);
  return (
    <>
      {rows.length ? (
        <Table
          columns={[
            t("Recipient", "گیرنده"),
            t("Subject", "موضوع"),
            t("Status", "وضعیت"),
            t("Time", "زمان"),
            t("Action", "اقدام"),
          ]}
        >
          {rows.map((email) => (
            <tr key={email.id}>
              <td>
                <bdi>{email.email}</bdi>
              </td>
              <td>
                <span dir="auto">{email.subject}</span>
              </td>
              <td>
                <Badge state={email.state} locale={locale} />
                {email.lastError && (
                  <small className={styles.muted} style={{ display: "block" }}>
                    <bdi>{email.lastError}</bdi>
                  </small>
                )}
              </td>
              <td>{dateLabel(email.createdAt, locale)}</td>
              <td>
                {email.retryAllowed && (
                  <Button disabled={busy} onClick={() => setRetry(email.id)}>
                    {t("Review retry", "بازبینی تلاش مجدد")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>{t("No emails have been recorded.", "هنوز ایمیلی ثبت نشده است.")}</Empty>
      )}
      <p className={styles.help}>
        {t(
          "Sent means the email service accepted the message. Delivery and bounce labels appear only when confirmed. Uncertain results must be checked before retrying.",
          "ارسال‌شده یعنی سرویس ایمیل پیام را پذیرفته است. تحویل و برگشت تنها پس از تأیید نمایش داده می‌شوند. پیش از تلاش مجدد، نتیجهٔ نامعلوم باید بررسی شود.",
        )}
      </p>
      {retry && (
        <Notice>
          <p>
            {t(
              "Retry this failed email with its approved content. Successful recipients are never included.",
              "همین ایمیل ناموفق را با متن تأییدشده دوباره تلاش کنید. گیرندگان موفق در آن نیستند.",
            )}
          </p>
          <div className={styles.actions}>
            <Button
              primary
              disabled={busy}
              onClick={() => {
                void act(
                  "email.retry",
                  { emailId: retry },
                  t("Retry request recorded.", "درخواست تلاش مجدد ثبت شد."),
                ).then((result) => {
                  if (result) {
                    setRetry(null);
                    reload();
                  }
                });
              }}
            >
              {t("Confirm retry", "تأیید تلاش مجدد")}
            </Button>
            <Button onClick={() => setRetry(null)}>{t("Cancel", "انصراف")}</Button>
          </div>
        </Notice>
      )}
    </>
  );
}
function Composer(props: AdminScreenProps) {
  const { data, t, locale, selected, navigate, act, busy } = props;
  const templates = data.templates ?? [];
  const [templateId, setTemplateId] = useState(
    templates.find((item) => item.id === "pilot_welcome")?.id ?? templates[0]?.id ?? "",
  );
  const [language, setLanguage] = useState<AdminLocale | "recipient">("recipient");
  const [editLanguage, setEditLanguage] = useState<AdminLocale>(locale);
  const initial = templates.find((item) => item.id === templateId);
  const template = templates.find((item) => item.id === templateId);
  const [subjects, setSubjects] = useState({
    en: readableTemplateText(initial?.subject.en ?? "", initial?.variableDefaults?.en),
    fa: readableTemplateText(initial?.subject.fa ?? "", initial?.variableDefaults?.fa),
  });
  const [bodies, setBodies] = useState({
    en: readableTemplateText(initial?.body.en ?? "", initial?.variableDefaults?.en),
    fa: readableTemplateText(initial?.body.fa ?? "", initial?.variableDefaults?.fa),
  });
  const [presentations, setPresentations] = useState<
    Record<AdminLocale, EmailPresentationSettings>
  >({
    en: templatePresentation(initial, "en"),
    fa: templatePresentation(initial, "fa"),
  });
  const [variables, setVariables] = useState<Record<AdminLocale, Record<string, string>>>({
    en: initial?.variableDefaults?.en ?? {},
    fa: initial?.variableDefaults?.fa ?? {},
  });
  const [note, setNote] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const detectedVariables = {
    en: manualTemplateVariables(
      subjects.en,
      [
        bodies.en,
        presentations.en.headline,
        presentations.en.preheader,
        presentations.en.action?.label,
        presentations.en.action?.url,
      ]
        .filter(Boolean)
        .join("\n"),
      template?.variableDefaults?.en,
    ),
    fa: manualTemplateVariables(
      subjects.fa,
      [
        bodies.fa,
        presentations.fa.headline,
        presentations.fa.preheader,
        presentations.fa.action?.label,
        presentations.fa.action?.url,
      ]
        .filter(Boolean)
        .join("\n"),
      template?.variableDefaults?.fa,
    ),
  };
  const editableVariables = manualTemplateVariables(
    subjects[editLanguage],
    [
      bodies[editLanguage],
      presentations[editLanguage].headline,
      presentations[editLanguage].preheader,
      presentations[editLanguage].action?.label,
      presentations[editLanguage].action?.url,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [acceptExcluded, setAcceptExcluded] = useState(false);
  const [sent, setSent] = useState<AdminEmail[] | null>(null);
  const [problem, setProblem] = useState<{
    language: AdminLocale;
    field: string;
    message: string;
  } | null>(null);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problem)
      form.current?.querySelector<HTMLElement>(`[data-compose-field="${problem.field}"]`)?.focus();
  }, [problem]);
  function chooseTemplate(id: string) {
    setTemplateId(id);
    const next = templates.find((item) => item.id === id);
    setSubjects({
      en: readableTemplateText(next?.subject.en ?? "", next?.variableDefaults?.en),
      fa: readableTemplateText(next?.subject.fa ?? "", next?.variableDefaults?.fa),
    });
    setBodies({
      en: readableTemplateText(next?.body.en ?? "", next?.variableDefaults?.en),
      fa: readableTemplateText(next?.body.fa ?? "", next?.variableDefaults?.fa),
    });
    setPresentations({
      en: templatePresentation(next, "en"),
      fa: templatePresentation(next, "fa"),
    });
    setVariables({ en: next?.variableDefaults?.en ?? {}, fa: next?.variableDefaults?.fa ?? {} });
    setNote("");
    setAdvanced(false);
    setProblem(null);
    setPreview(null);
    setSent(null);
  }
  async function prepare() {
    const active = language === "recipient" ? editLanguage : language;
    const missingVariable = detectedVariables[active].find(
      (name) => !variables[active][name]?.trim(),
    );
    const field =
      language === "recipient"
        ? null
        : !subjects[active].trim()
          ? "subject"
          : !bodies[active].trim()
            ? "body"
            : missingVariable
              ? `variable-${missingVariable}`
              : !presentations[active].action?.label.trim() && presentations[active].action
                ? "actionLabel"
                : !validPresentation(presentations[active])
                  ? "actionUrl"
                  : null;
    if (field) {
      const message =
        field === "subject"
          ? t("Enter a subject for this email.", "موضوع این ایمیل را وارد کنید.")
          : field === "body"
            ? t("Enter the email message.", "متن ایمیل را وارد کنید.")
            : missingVariable
              ? `${templateVariableLabel(missingVariable, t)}: ${t("Add the detail used in this message, or remove its placeholder from the message.", "این بخش پیام را تکمیل کنید یا جای آن را از متن حذف کنید.")}`
              : field === "actionLabel"
                ? t(
                    "Enter the button text, or turn off the action button.",
                    "متن دکمه را وارد کنید یا دکمهٔ اقدام را بردارید.",
                  )
                : t(
                    "Use a complete HTTPS button link, or keep the automatic app link.",
                    "لینک کامل HTTPS برای دکمه وارد کنید یا لینک خودکار اپ را نگه دارید.",
                  );
      setEditLanguage(active);
      setAdvanced(field.startsWith("variable-") || field.startsWith("action"));
      setProblem({ language: active, field, message });
      return;
    }
    setProblem(null);
    const contentLanguages = language === "recipient" ? (["en", "fa"] as const) : [language];
    const explicitVariables = Object.fromEntries(
      contentLanguages.map((key) => [
        key,
        Object.fromEntries(Object.entries(variables[key]).filter(([, value]) => value.trim())),
      ]),
    );
    const result = await act(
      "email.preview",
      {
        userIds: selected,
        templateId: templateId || null,
        language,
        ...(language === "recipient"
          ? {
              localizedContent: Object.fromEntries(
                contentLanguages.map((key) => [
                  key,
                  { subject: subjects[key], body: emailBodyWithNote(bodies[key], note) },
                ]),
              ),
              localizedPresentation: Object.fromEntries(
                contentLanguages.map((key) => [key, presentationInput(presentations[key])]),
              ),
            }
          : {
              subject: subjects[active],
              body: emailBodyWithNote(bodies[active], note),
              presentation: presentationInput(presentations[active]),
            }),
        localizedVariables: explicitVariables,
        reason: reason.trim() || "Owner-reviewed user communication",
      },
      undefined,
      (fields) => {
        for (const path of Object.keys(fields)) {
          const content = /^localizedContent\.(en|fa)\.(subject|body)$/.exec(path);
          const variable = /^localizedVariables\.(en|fa)\.([a-z_][a-z0-9_]*)$/.exec(path);
          const action = /^localizedPresentation\.(en|fa)\.action\.(label|url)$/.exec(path);
          const matched = content ?? variable ?? action;
          if (!matched) continue;
          const locale = matched[1] as AdminLocale;
          const field = content
            ? (matched[2] ?? "body")
            : variable
              ? `variable-${matched[2]}`
              : matched[2] === "label"
                ? "actionLabel"
                : "actionUrl";
          const label = content
            ? matched[2] === "subject"
              ? t("Subject", "موضوع")
              : t("Message", "متن پیام")
            : variable
              ? templateVariableLabel(matched[2] ?? "", t)
              : matched[2] === "label"
                ? t("Button text", "متن دکمه")
                : t("Button link", "لینک دکمه");
          setEditLanguage(locale);
          setAdvanced(Boolean(variable || action));
          setProblem({
            language: locale,
            field,
            message: `${locale === "fa" ? "فارسی" : "English"} · ${label}: ${action && matched[2] === "url" ? t("Use a complete HTTPS link, or keep the automatic app link.", "لینک کامل HTTPS وارد کنید یا لینک خودکار اپ را نگه دارید.") : t("Complete this field for the selected recipient's language.", "این فیلد را برای زبان گیرندهٔ انتخاب‌شده تکمیل کنید.")}`,
          });
          return true;
        }
        return false;
      },
    );
    if (result?.preview) {
      setPreview(result.preview);
      setRecipientIndex(0);
      setAcceptExcluded(false);
    }
  }
  async function send() {
    if (!preview) return;
    const result = await act("email.send", {
      previewId: preview.previewId,
      ...(preview.draftId ? { draftId: preview.draftId, revision: preview.revision } : {}),
    });
    if (result) {
      setSent(result.emails ?? []);
      setPreview(null);
    }
  }
  if (!selected.length)
    return (
      <Panel>
        <Empty>
          {t(
            "Choose one or more users before composing an email.",
            "پیش از نوشتن ایمیل، یک یا چند کاربر انتخاب کنید.",
          )}
        </Empty>
        <Button primary onClick={() => navigate("users")}>
          {t("Choose users", "انتخاب کاربران")}
        </Button>
      </Panel>
    );
  const recipient = preview?.recipients[recipientIndex];
  const expired = preview ? Date.parse(preview.expiresAt) <= Date.now() : false;
  const currentProblem = problem?.language === editLanguage ? problem : null;
  return (
    <>
      <Notice>
        <strong>
          {formatNumber(selected.length, locale)} {t("selected recipients", "گیرندهٔ انتخاب‌شده")}
        </strong>
        <p>
          {t(
            "Each person receives a separate email. The final addresses and resolved text are shown before approval.",
            "هر نفر یک ایمیل جدا دریافت می‌کند. نشانی نهایی و متن پرشده پیش از تأیید نشان داده می‌شوند.",
          )}
        </p>
      </Notice>
      {sent !== null ? (
        <Panel title={t("Approved email results", "نتیجهٔ ایمیل‌های تأییدشده")}>
          <EmailRows rows={sent} props={props} />
          <div className={styles.actions}>
            <Button primary onClick={() => navigate("history")}>
              {t("Track email status", "پیگیری وضعیت ایمیل")}
            </Button>
            <Button onClick={() => navigate("tasks")}>
              {t("Back to tasks", "بازگشت به کارها")}
            </Button>
          </div>
        </Panel>
      ) : preview === null ? (
        <div ref={form}>
          <Panel title={t("Message details", "جزئیات پیام")}>
            <p className={styles.help}>
              {t(
                "Routine templates are ready to use. Check the preview, then approve sending.",
                "قالب‌های روتین آمادهٔ استفاده‌اند. پیش‌نمایش را بررسی کنید و ارسال را تأیید کنید.",
              )}
            </p>
            <div className={styles.split}>
              <Field label={t("Template", "قالب")}>
                <select
                  disabled={busy}
                  className={styles.select}
                  value={templateId}
                  onChange={(e) => chooseTemplate(e.target.value)}
                >
                  <option value="">{t("Blank message", "متن آزاد")}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name[locale]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Email language", "زبان ایمیل")}>
                <select
                  disabled={busy}
                  className={styles.select}
                  value={language}
                  onChange={(e) => {
                    const value = e.target.value as AdminLocale | "recipient";
                    setLanguage(value);
                    if (value !== "recipient") setEditLanguage(value);
                    setPreview(null);
                    setProblem(null);
                  }}
                >
                  <option value="en">English</option>
                  <option value="fa">فارسی</option>
                  <option value="recipient">
                    {t("Use each recipient's preference", "طبق ترجیح هر گیرنده")}
                  </option>
                </select>
              </Field>
            </div>
            {language === "recipient" && (
              <div className={styles.tabs}>
                {(["en", "fa"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={styles.button}
                    aria-pressed={editLanguage === value}
                    onClick={() => {
                      setEditLanguage(value);
                      setProblem(null);
                    }}
                  >
                    {value === "en"
                      ? t("Edit English", "ویرایش انگلیسی")
                      : t("Edit Persian", "ویرایش فارسی")}
                  </button>
                ))}
              </div>
            )}
            <Field
              label={t("Subject", "موضوع")}
              help={currentProblem?.field === "subject" ? currentProblem.message : undefined}
            >
              <input
                disabled={busy}
                className={styles.input}
                lang={editLanguage}
                dir={editLanguage === "fa" ? "rtl" : "ltr"}
                value={subjects[editLanguage]}
                data-compose-field="subject"
                aria-invalid={currentProblem?.field === "subject" || undefined}
                onChange={(e) => {
                  setSubjects({ ...subjects, [editLanguage]: e.target.value });
                  setPreview(null);
                  setProblem(null);
                }}
              />
            </Field>
            <Field
              label={t("Message", "متن پیام")}
              help={
                currentProblem?.field === "body"
                  ? currentProblem.message
                  : t(
                      "Personal details and the app link are filled automatically in the preview. You can edit the message.",
                      "اطلاعات شخصی و لینک اپ در پیش‌نمایش خودکار تکمیل می‌شوند. می‌توانید متن را ویرایش کنید.",
                    )
              }
            >
              <textarea
                disabled={busy}
                className={styles.input}
                lang={editLanguage}
                dir={editLanguage === "fa" ? "rtl" : "ltr"}
                value={bodies[editLanguage]}
                data-compose-field="body"
                aria-invalid={currentProblem?.field === "body" || undefined}
                onChange={(e) => {
                  setBodies({ ...bodies, [editLanguage]: e.target.value });
                  setPreview(null);
                  setProblem(null);
                }}
              />
            </Field>
            <Field
              label={t("Additional message (optional)", "پیام تکمیلی (اختیاری)")}
              help={t(
                "Added to every selected recipient's message. Leave empty to use the ready template.",
                "این توضیح به پیام همهٔ گیرندگان انتخاب‌شده اضافه می‌شود. برای استفاده از قالب آماده خالی بگذارید.",
              )}
            >
              <textarea
                disabled={busy}
                className={styles.input}
                style={{ minHeight: 96 }}
                dir="auto"
                maxLength={4000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setPreview(null);
                }}
              />
            </Field>
            <details
              className={styles.emailAdvanced}
              open={advanced}
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
            >
              <summary>{t("Advanced options", "تنظیمات بیشتر")}</summary>
              <p className={styles.help}>
                {t(
                  "Optional changes to the design and template details. Recalino branding is already included.",
                  "تغییرات اختیاری در ظاهر و جزئیات قالب. برندینگ ریکالینو از قبل اضافه شده است.",
                )}
              </p>
              <PresentationFields
                value={presentations[editLanguage]}
                language={editLanguage}
                t={t}
                busy={busy}
                onChange={(value) => {
                  setPresentations({ ...presentations, [editLanguage]: value });
                  setPreview(null);
                  setProblem(null);
                }}
                problem={
                  currentProblem?.field === "actionLabel" || currentProblem?.field === "actionUrl"
                    ? currentProblem.field
                    : undefined
                }
              />
              {editableVariables.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h3>{t("Template details", "جزئیات قالب")}</h3>
                  <p className={styles.help}>
                    {t(
                      "Ready details can be changed here. Custom placeholders need their message-specific text.",
                      "جزئیات آماده را می‌توانید اینجا تغییر دهید. بخش‌های سفارشی به متن مخصوص همان پیام نیاز دارند.",
                    )}
                  </p>
                  <div className={styles.split}>
                    {editableVariables.map((name) => (
                      <Field
                        key={name}
                        label={templateVariableLabel(name, t)}
                        help={
                          currentProblem?.field === `variable-${name}`
                            ? currentProblem.message
                            : template?.variableDefaults?.[editLanguage]?.[name]
                              ? t(
                                  "Leave empty to use the ready template text.",
                                  "اگر خالی باشد، متن آمادهٔ قالب استفاده می‌شود.",
                                )
                              : undefined
                        }
                      >
                        <textarea
                          disabled={busy}
                          className={styles.input}
                          style={{ minHeight: 96 }}
                          lang={editLanguage}
                          dir={editLanguage === "fa" ? "rtl" : "ltr"}
                          value={variables[editLanguage][name] ?? ""}
                          data-compose-field={`variable-${name}`}
                          aria-invalid={currentProblem?.field === `variable-${name}` || undefined}
                          onChange={(e) => {
                            setVariables({
                              ...variables,
                              [editLanguage]: {
                                ...variables[editLanguage],
                                [name]: e.target.value,
                              },
                            });
                            setPreview(null);
                            setProblem(null);
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
              <Field label={t("Internal reason (optional)", "دلیل داخلی (اختیاری)")}>
                <input
                  disabled={busy}
                  className={styles.input}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setPreview(null);
                  }}
                />
              </Field>
            </details>
            {problem && (
              <p className={styles.composeError} role="alert">
                {problem.message}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                primary
                disabled={busy}
                onClick={() => {
                  void prepare();
                }}
              >
                {t("Preview email", "پیش‌نمایش ایمیل")}
              </Button>
              <Button onClick={() => navigate("users")}>
                {t("Change recipients", "تغییر گیرندگان")}
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
      {preview && (
        <Panel title={t("Review & approve", "بازبینی و تأیید")}>
          <Table
            columns={[t("Recipient", "گیرنده"), t("Language", "زبان"), t("Preview", "پیش‌نمایش")]}
          >
            {preview.recipients.map((item, index) => (
              <tr key={item.userId}>
                <td>
                  <bdi>{item.email}</bdi>
                </td>
                <td>{item.language === "fa" ? "فارسی" : "English"}</td>
                <td>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => setRecipientIndex(index)}
                  >
                    {t("Review message", "بررسی پیام")}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          {preview.excluded.length > 0 && (
            <Notice warning>
              <strong>
                {formatNumber(preview.excluded.length, locale)}{" "}
                {t("excluded recipients", "گیرندهٔ کنارگذاشته‌شده")}
              </strong>
              {preview.excluded.map((item) => (
                <p key={item.userId}>
                  <bdi>{item.userId}</bdi> —{" "}
                  {t(
                    "Address or required fields need attention.",
                    "نشانی یا فیلدهای ضروری نیاز به بررسی دارند.",
                  )}
                </p>
              ))}
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={acceptExcluded}
                  onChange={(e) => setAcceptExcluded(e.target.checked)}
                />
                {t(
                  "Send only to the eligible recipients shown above.",
                  "فقط برای گیرندگان مجازِ فهرست بالا ارسال شود.",
                )}
              </label>
            </Notice>
          )}
          {recipient && (
            <div
              className={styles.panel}
              style={{ marginTop: 20 }}
              lang={recipient.language}
              dir={recipient.language === "fa" ? "rtl" : "ltr"}
            >
              <p>
                <bdi>{recipient.email}</bdi>
                <span className={styles.badge}>
                  {recipient.language === "fa" ? "فارسی · RTL" : "English · LTR"}
                </span>
              </p>
              <h3>{recipient.subject}</h3>
              <BrandedPreview
                presentation={recipient.presentation}
                body={recipient.body}
                language={recipient.language}
                t={t}
              />
            </div>
          )}
          {expired && (
            <Notice warning>
              {t(
                "This preview expired. Prepare a new preview.",
                "این پیش‌نمایش منقضی شده است. پیش‌نمایش تازه تهیه کنید.",
              )}
            </Notice>
          )}
          <p className={styles.help}>
            {t(
              "Approval sends only this saved recipient list and message version. Editing requires a new preview.",
              "تأیید فقط همین فهرست گیرنده و نسخهٔ ذخیره‌شدهٔ پیام را ارسال می‌کند. ویرایش به پیش‌نمایش تازه نیاز دارد.",
            )}
          </p>
          <div className={styles.actions}>
            <Button
              primary
              disabled={
                busy ||
                expired ||
                preview.recipients.length === 0 ||
                (preview.excluded.length > 0 && !acceptExcluded)
              }
              onClick={() => {
                void send();
              }}
            >
              {t("Approve & send to", "تأیید و ارسال برای")}{" "}
              {formatNumber(preview.recipients.length, locale)} {t("users", "کاربر")}
            </Button>
            <Button onClick={() => setPreview(null)}>{t("Edit message", "ویرایش پیام")}</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
function templateVariableLabel(name: string, t: AdminScreenProps["t"]): string {
  const labels: Record<string, [string, string]> = {
    next_step_text: ["Next step", "گام بعدی"],
    acknowledgement_text: ["Acknowledgement", "متن تأیید دریافت"],
    conversation_subject: ["Conversation subject", "موضوع گفت‌وگو"],
    reply_text: ["Reply text", "متن پاسخ"],
    issue_summary: ["Issue summary", "خلاصهٔ مشکل"],
    current_status_text: ["Current status", "وضعیت فعلی"],
    user_action_text: ["Required user action", "اقدام لازم کاربر"],
  };
  const label = labels[name];
  return label ? t(...label) : `${t("Variable text", "متن متغیر")} · ${name}`;
}
function Templates(props: AdminScreenProps) {
  const { data, t, locale, act, busy, reload, compose, selected } = props;
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [editLanguage, setEditLanguage] = useState<AdminLocale>("en");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  return (
    <>
      <MessageTabs props={props} active="templates" />
      <Panel title={t("Routine emails", "ایمیل‌های روتین")}>
        {data.templates?.length ? (
          data.templates.map((template) => (
            <div className={styles.task} key={template.id}>
              <div>
                <strong>{template.name[locale]}</strong>
                <small className={styles.muted}>
                  {t(
                    "Editable subject and message · Persian & English",
                    "موضوع و متن قابل ویرایش · فارسی و انگلیسی",
                  )}
                </small>
              </div>
              <div className={styles.actions} style={{ marginTop: 0 }}>
                <Button
                  onClick={() => {
                    setEditing(template);
                    setReview(false);
                    setReason("");
                  }}
                >
                  {t("Edit template", "ویرایش قالب")}
                </Button>
                {selected.length > 0 && (
                  <Button onClick={() => compose(selected)}>
                    {t("Write email", "نوشتن ایمیل")}
                  </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          <Empty>{t("No email templates are configured.", "قالب ایمیلی تنظیم نشده است.")}</Empty>
        )}
      </Panel>
      {editing && (
        <Panel title={t("Template revision", "نسخهٔ قالب")}>
          <Field label={t("Template identifier", "شناسهٔ قالب")}>
            <input
              className={styles.input}
              dir="ltr"
              value={editing.id}
              disabled={Boolean(editing.version)}
              onChange={(e) => {
                setEditing({ ...editing, id: e.target.value });
                setReview(false);
              }}
            />
          </Field>
          <div className={styles.tabs}>
            {(["en", "fa"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={styles.button}
                aria-pressed={editLanguage === value}
                onClick={() => setEditLanguage(value)}
              >
                {value === "en" ? "English" : "فارسی"}
              </button>
            ))}
          </div>
          <Field label={t("Template name", "نام قالب")}>
            <input
              className={styles.input}
              dir="auto"
              value={editing.name[editLanguage]}
              readOnly
            />
          </Field>
          <Field label={t("Subject", "موضوع")}>
            <input
              className={styles.input}
              dir="auto"
              value={editing.subject[editLanguage]}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  subject: { ...editing.subject, [editLanguage]: e.target.value },
                });
                setReview(false);
              }}
            />
          </Field>
          <Field label={t("Message", "متن پیام")}>
            <textarea
              className={styles.input}
              dir="auto"
              value={editing.body[editLanguage]}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  body: { ...editing.body, [editLanguage]: e.target.value },
                });
                setReview(false);
              }}
            />
          </Field>
          <PresentationFields
            value={templatePresentation(editing, editLanguage)}
            language={editLanguage}
            t={t}
            busy={busy}
            onChange={(value) => {
              setEditing({
                ...editing,
                presentation: { ...editing.presentation, [editLanguage]: value },
              });
              setReview(false);
            }}
          />
          <Field label={t("Reason", "دلیل")}>
            <input
              className={styles.input}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReview(false);
              }}
            />
          </Field>
          {review && (
            <Notice>
              {t(
                "This creates a new shared template version. Previously approved emails keep their original text.",
                "نسخهٔ تازهٔ قالب مشترک ساخته می‌شود. ایمیل‌های تأییدشدهٔ قبلی متن اصلی خود را نگه می‌دارند.",
              )}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button
              primary
              disabled={
                busy ||
                !editing.id.trim() ||
                !reason.trim() ||
                !(["en", "fa"] as const).every(
                  (lang) =>
                    editing.name[lang].trim() &&
                    editing.subject[lang].trim() &&
                    editing.body[lang].trim() &&
                    validPresentation(templatePresentation(editing, lang)),
                )
              }
              onClick={() => {
                if (!review) setReview(true);
                else
                  void act(
                    "template.save",
                    {
                      templateId: editing.id,
                      expectedVersion: editing.version,
                      subject: editing.subject,
                      body: editing.body,
                      presentation: {
                        en: presentationInput(templatePresentation(editing, "en")),
                        fa: presentationInput(templatePresentation(editing, "fa")),
                      },
                      reason,
                    },
                    t("Template version saved.", "نسخهٔ قالب ذخیره شد."),
                  ).then((result) => {
                    if (result) {
                      setEditing(null);
                      reload();
                    }
                  });
              }}
            >
              {review
                ? t("Confirm template revision", "تأیید نسخهٔ قالب")
                : t("Review template", "بازبینی قالب")}
            </Button>
            <Button onClick={() => setEditing(null)}>{t("Cancel", "انصراف")}</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
function FeedbackInbox(props: AdminScreenProps) {
  const { data, t, locale, navigate } = props;
  const [filter, setFilter] = useState("all");
  const threads = (data.threads ?? []).filter(
    (thread) => filter === "all" || thread.state === filter,
  );
  return (
    <>
      <MessageTabs props={props} active="feedback" />
      <div className={styles.tabs}>
        {(
          [
            ["all", t("All", "همه")],
            ["awaiting_reply", t("Needs reply", "نیازمند پاسخ")],
            ["replied", t("Replied", "پاسخ داده‌شده")],
            ["closed", t("Closed", "بسته")],
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
      <Panel title={t("Inbox", "صندوق پیام‌ها")}>
        {threads.length ? (
          <Table
            columns={[
              t("From", "فرستنده"),
              t("Subject", "موضوع"),
              t("Category", "دسته"),
              t("Status", "وضعیت"),
              t("Updated", "به‌روزرسانی"),
            ]}
          >
            {threads.map((thread) => (
              <tr key={thread.id}>
                <td>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => navigate("user", thread.userId)}
                  >
                    {thread.name ?? t("User", "کاربر")}
                  </button>
                  <br />
                  <bdi className={styles.muted}>{thread.email ?? "—"}</bdi>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.link}
                    dir="auto"
                    onClick={() => navigate("thread", thread.id)}
                  >
                    {thread.subject}
                  </button>
                </td>
                <td>
                  <Badge state={thread.category} locale={locale} />
                </td>
                <td>
                  <Badge state={thread.state} locale={locale} />
                </td>
                <td>{dateLabel(thread.updatedAt, locale)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>
            {t("No feedback matches this filter.", "بازخوردی با این فیلتر وجود ندارد.")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
function Thread(props: AdminScreenProps) {
  const { data, t, locale, act, busy, reload, navigate } = props;
  const thread = data.thread;
  const [body, setBody] = useState(thread?.replyDraft ?? "");
  const [language, setLanguage] = useState<AdminLocale>("en");
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [notify, setNotify] = useState(thread?.notifyByEmail ?? false);
  const [replyPresentations, setReplyPresentations] = useState<
    Record<AdminLocale, EmailPresentationSettings>
  >({
    en: { action: { label: "View conversation", url: "{{conversation_link}}" } },
    fa: { action: { label: "مشاهدهٔ گفت‌وگو", url: "{{conversation_link}}" } },
  });
  const replyPresentation = replyPresentations[language];
  const [replyPreview, setReplyPreview] = useState<AdminResult["replyPreview"] | null>(null);
  const [invalidPresentation, setInvalidPresentation] = useState(false);
  if (!thread)
    return <Empty>{t("This conversation is unavailable.", "این گفت‌وگو در دسترس نیست.")}</Empty>;
  return (
    <>
      <Panel title={thread.subject}>
        <div className={styles.actions} style={{ marginTop: 0 }}>
          <Badge state={thread.state} locale={locale} />
          <button
            type="button"
            className={styles.link}
            onClick={() => navigate("user", thread.userId)}
          >
            {thread.name ?? t("View account", "دیدن حساب")}
          </button>
          <bdi className={styles.muted}>{thread.email}</bdi>
        </div>
        <div style={{ marginTop: 24 }}>
          {thread.messages.map((message) => (
            <article
              key={message.id}
              className={`${styles.message} ${message.author === "admin" ? styles.messageAdmin : ""}`}
            >
              <div className={styles.messageMeta}>
                <strong>
                  {message.author === "admin"
                    ? t("Recalino team", "تیم ریکالینو")
                    : t("Learner", "زبان‌آموز")}
                </strong>
                <span>{dateLabel(message.createdAt, locale)}</span>
              </div>
              <p dir="auto">{message.body}</p>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title={t("Prepare a reply", "آماده‌کردن پاسخ")}>
        <div className={styles.actions} style={{ marginTop: 0, marginBottom: 20 }}>
          <Button
            disabled={busy}
            onClick={() => {
              void act("feedback.suggest", { threadId: thread.id, language }).then((result) => {
                if (result?.body) {
                  setBody(result.body);
                  setSource(result.source ?? "template");
                  setReplyPreview(null);
                }
              });
            }}
          >
            {t("Prepare suggested reply", "آماده‌کردن پاسخ پیشنهادی")}
          </Button>
        </div>
        {source && (
          <Notice>
            {source === "ai"
              ? t(
                  "AI suggestion. Check the facts and edit before approving.",
                  "پیشنهاد AI؛ اطلاعات را بررسی کنید و پیش از تأیید ویرایش کنید.",
                )
              : t(
                  "Routine suggested text. Check it against this conversation before approving.",
                  "متن پیشنهادی روتین؛ پیش از تأیید آن را با این گفت‌وگو تطبیق دهید.",
                )}
          </Notice>
        )}
        <Field label={t("Reply language", "زبان پاسخ")}>
          <select
            disabled={busy}
            className={styles.select}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as AdminLocale);
              setReplyPreview(null);
            }}
          >
            <option value="en">English</option>
            <option value="fa">فارسی</option>
          </select>
        </Field>
        <Field label={t("Reply", "پاسخ")}>
          <textarea
            disabled={busy}
            className={styles.input}
            dir="auto"
            lang={language}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setReplyPreview(null);
            }}
          />
        </Field>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            className={styles.check}
            checked={notify}
            disabled={busy || !thread.notifyByEmail}
            onChange={(e) => {
              setNotify(e.target.checked);
              setReplyPreview(null);
            }}
          />
          {t("Also email the approved reply", "ارسال ایمیلی پاسخ تأییدشده")}
        </label>
        <p className={styles.help}>
          {thread.notifyByEmail
            ? t(
                "The learner opted in to email notifications. The reply always appears in their private in-app conversation.",
                "زبان‌آموز اعلان ایمیلی را انتخاب کرده است. پاسخ همیشه در گفت‌وگوی خصوصی او داخل اپ نمایش داده می‌شود.",
              )
            : t(
                "The learner did not request email notifications. Reply in the app.",
                "زبان‌آموز اعلان ایمیلی نخواسته است. پاسخ داخل اپ ثبت می‌شود.",
              )}
        </p>
        {notify && (
          <PresentationFields
            value={replyPresentation}
            onChange={(value) => {
              setReplyPresentations({ ...replyPresentations, [language]: value });
              setReplyPreview(null);
              setInvalidPresentation(false);
            }}
            language={language}
            t={t}
            busy={busy}
          />
        )}
        {invalidPresentation && (
          <Notice error>
            {t(
              "A button needs text and a valid HTTPS link.",
              "دکمه به متن و لینک معتبر HTTPS نیاز دارد.",
            )}
          </Notice>
        )}
        {replyPreview && (
          <Notice>
            <strong>{t("Ready for your approval", "آمادهٔ تأیید شما")}</strong>
            <p>
              <bdi>{thread.email}</bdi>
            </p>
            <div className={styles.emailBody} dir="auto">
              {replyPreview.body}
            </div>
            <p>
              {notify
                ? t("In-app reply and an email notification.", "پاسخ داخل اپ و اعلان ایمیلی.")
                : t("In-app reply only.", "پاسخ داخل اپ.")}
            </p>
          </Notice>
        )}
        {replyPreview?.emailPreview && (
          <div
            className={styles.panel}
            lang={replyPreview.language}
            dir={replyPreview.language === "fa" ? "rtl" : "ltr"}
          >
            <p>
              <bdi>{replyPreview.emailPreview.email}</bdi>
            </p>
            <h3>{replyPreview.emailPreview.subject}</h3>
            <BrandedPreview
              presentation={replyPreview.emailPreview.presentation}
              body={replyPreview.emailPreview.body}
              language={replyPreview.language}
              t={t}
            />
          </div>
        )}
        <div className={styles.actions}>
          <Button
            primary
            disabled={busy || !body.trim()}
            onClick={() => {
              if (!replyPreview) {
                const valid = !notify || validPresentation(replyPresentation);
                setInvalidPresentation(!valid);
                if (valid)
                  void act("feedback.preview", {
                    threadId: thread.id,
                    body,
                    language,
                    notifyByEmail: notify,
                    ...(notify ? { presentation: presentationInput(replyPresentation) } : {}),
                  }).then((result) => {
                    if (result?.replyPreview) setReplyPreview(result.replyPreview);
                  });
              } else
                void act(
                  "feedback.reply",
                  {
                    threadId: thread.id,
                    draftId: replyPreview.draftId,
                    revision: replyPreview.revision,
                    notifyByEmail: notify,
                  },
                  t(
                    "The approved reply was recorded. Check email history for any notification delivery.",
                    "پاسخ تأییدشده ثبت شد. وضعیت تحویل اعلان را در تاریخچهٔ ایمیل بررسی کنید.",
                  ),
                ).then((result) => {
                  if (result) {
                    setBody("");
                    setReplyPreview(null);
                    setSource(null);
                    reload();
                  }
                });
            }}
          >
            {replyPreview
              ? t("Approve & send reply", "تأیید و ارسال پاسخ")
              : t("Review reply", "بازبینی پاسخ")}
          </Button>
          <Button onClick={() => navigate("feedback")}>
            {t("Back to inbox", "بازگشت به صندوق")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void act(
                "feedback.close",
                { threadId: thread.id, closed: thread.state !== "closed" },
                t("Conversation status saved.", "وضعیت گفت‌وگو ذخیره شد."),
              ).then((result) => {
                if (result) reload();
              });
            }}
          >
            {thread.state === "closed"
              ? t("Reopen conversation", "بازکردن دوبارهٔ گفت‌وگو")
              : t("Close conversation", "بستن گفت‌وگو")}
          </Button>
        </div>
      </Panel>
    </>
  );
}
export function CommunicationScreens(props: AdminScreenProps) {
  if (props.mode === "compose") return <Composer {...props} />;
  if (props.mode === "templates") return <Templates {...props} />;
  if (props.mode === "feedback") return <FeedbackInbox {...props} />;
  if (props.mode === "thread") return <Thread key={props.data.thread?.id} {...props} />;
  if (props.mode === "history")
    return (
      <>
        <MessageTabs props={props} active="history" />
        <Panel title={props.t("Email history", "تاریخچهٔ ایمیل")}>
          <EmailRows rows={props.data.emails ?? []} props={props} />
        </Panel>
      </>
    );
  return null;
}
