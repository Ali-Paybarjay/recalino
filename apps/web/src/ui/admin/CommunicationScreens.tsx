"use client";

import { useState } from "react";
import styles from "./Admin.module.css";
import type { AdminScreenProps } from "./AdminScreenProps";
import { dateLabel } from "./CoreScreens";
import type { AdminEmail, AdminLocale, EmailPreview, EmailTemplate } from "./contracts";
import { formatNumber, manualTemplateVariables } from "./model";
import { Badge, Button, Empty, Field, Notice, Panel, Table } from "./primitives";

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
  const [language, setLanguage] = useState<AdminLocale | "recipient">("en");
  const [editLanguage, setEditLanguage] = useState<AdminLocale>("en");
  const initial = templates.find((item) => item.id === templateId);
  const [subjects, setSubjects] = useState({
    en: initial?.subject.en ?? "",
    fa: initial?.subject.fa ?? "",
  });
  const [bodies, setBodies] = useState({ en: initial?.body.en ?? "", fa: initial?.body.fa ?? "" });
  const [variables, setVariables] = useState<Record<AdminLocale, Record<string, string>>>({
    en: {},
    fa: {},
  });
  const detectedVariables = {
    en: manualTemplateVariables(subjects.en, bodies.en),
    fa: manualTemplateVariables(subjects.fa, bodies.fa),
  };
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [acceptExcluded, setAcceptExcluded] = useState(false);
  const [sent, setSent] = useState<AdminEmail[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  function chooseTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    setSubjects(template?.subject ?? { en: "", fa: "" });
    setBodies(template?.body ?? { en: "", fa: "" });
    setVariables({ en: {}, fa: {} });
    setPreview(null);
    setSent(null);
  }
  async function prepare() {
    const required = language === "recipient" ? (["en", "fa"] as const) : [language];
    const valid =
      selected.length > 0 &&
      required.every(
        (key) =>
          subjects[key].trim() &&
          bodies[key].trim() &&
          detectedVariables[key].every((name) => variables[key][name]?.trim()),
      );
    setInvalid(!valid);
    if (!valid) return;
    const result = await act("email.preview", {
      userIds: selected,
      templateId: templateId || null,
      language,
      subject: subjects[editLanguage],
      body: bodies[editLanguage],
      ...(language === "recipient"
        ? {
            localizedContent: {
              en: { subject: subjects.en, body: bodies.en },
              fa: { subject: subjects.fa, body: bodies.fa },
            },
          }
        : {}),
      ...(required.some((key) => detectedVariables[key].length > 0)
        ? {
            localizedVariables: Object.fromEntries(
              (["en", "fa"] as const).map((key) => [
                key,
                Object.fromEntries(
                  detectedVariables[key].map((name) => [name, variables[key][name] ?? ""]),
                ),
              ]),
            ),
          }
        : {}),
      reason: reason.trim() || "Owner-reviewed user communication",
    });
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
      ) : (
        <Panel title={t("Message details", "جزئیات پیام")}>
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
                  onClick={() => setEditLanguage(value)}
                >
                  {value === "en" ? "English" : "فارسی"}
                </button>
              ))}
            </div>
          )}
          <Field label={t("Subject", "موضوع")}>
            <input
              disabled={busy}
              className={styles.input}
              lang={editLanguage}
              dir={editLanguage === "fa" ? "rtl" : "ltr"}
              value={subjects[editLanguage]}
              onChange={(e) => {
                setSubjects({ ...subjects, [editLanguage]: e.target.value });
                setPreview(null);
              }}
            />
          </Field>
          <Field
            label={t("Message", "متن پیام")}
            help={t(
              "Supported variables: {{first_name}}, {{app_link}}, {{pilot_end_date}}. Review every resolved value before sending.",
              "متغیرهای مجاز: {{first_name}}، {{app_link}}، {{pilot_end_date}}. مقدارهای پرشده را پیش از ارسال بررسی کنید.",
            )}
          >
            <textarea
              disabled={busy}
              className={styles.input}
              lang={editLanguage}
              dir={editLanguage === "fa" ? "rtl" : "ltr"}
              value={bodies[editLanguage]}
              onChange={(e) => {
                setBodies({ ...bodies, [editLanguage]: e.target.value });
                setPreview(null);
              }}
            />
          </Field>
          {detectedVariables[editLanguage].length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3>{t("Complete template fields", "تکمیل فیلدهای قالب")}</h3>
              <p className={styles.help}>
                {t(
                  "These details fill the selected message. Account, allowance and application-link values are filled securely by the server.",
                  "این جزئیات در متن انتخابی قرار می‌گیرند. اطلاعات حساب، سهمیه و لینک اپ به‌صورت امن از سرور پر می‌شوند.",
                )}
              </p>
              <div className={styles.split}>
                {detectedVariables[editLanguage].map((name) => (
                  <Field key={name} label={templateVariableLabel(name, t)} help={`{{${name}}}`}>
                    <textarea
                      disabled={busy}
                      className={styles.input}
                      style={{ minHeight: 96 }}
                      lang={editLanguage}
                      dir={editLanguage === "fa" ? "rtl" : "ltr"}
                      value={variables[editLanguage][name] ?? ""}
                      onChange={(e) => {
                        setVariables({
                          ...variables,
                          [editLanguage]: { ...variables[editLanguage], [name]: e.target.value },
                        });
                        setPreview(null);
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
          {invalid && (
            <Notice error>
              {t(
                "Complete the subject, message and template fields for the chosen language. Recipient preference needs both language versions.",
                "موضوع، متن و فیلدهای قالبِ زبان انتخابی را کامل کنید. گزینهٔ ترجیح گیرنده به هر دو نسخهٔ زبانی نیاز دارد.",
              )}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button
              primary
              disabled={busy}
              onClick={() => {
                void prepare();
              }}
            >
              {t("Prepare exact preview", "آماده‌کردن پیش‌نمایش دقیق")}
            </Button>
            <Button onClick={() => navigate("users")}>
              {t("Change recipients", "تغییر گیرندگان")}
            </Button>
          </div>
        </Panel>
      )}
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
              </p>
              <h3>{recipient.subject}</h3>
              <div className={styles.emailBody} dir="auto">
                {recipient.body}
              </div>
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
                    editing.body[lang].trim(),
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
  const [review, setReview] = useState(false);
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
                  setReview(false);
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
              setReview(false);
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
              setReview(false);
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
              setReview(false);
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
        {review && (
          <Notice>
            <strong>{t("Ready for your approval", "آمادهٔ تأیید شما")}</strong>
            <p>
              <bdi>{thread.email}</bdi>
            </p>
            <div className={styles.emailBody} dir="auto">
              {body}
            </div>
            <p>
              {notify
                ? t("In-app reply and an email notification.", "پاسخ داخل اپ و اعلان ایمیلی.")
                : t("In-app reply only.", "پاسخ داخل اپ.")}
            </p>
          </Notice>
        )}
        <div className={styles.actions}>
          <Button
            primary
            disabled={busy || !body.trim()}
            onClick={() => {
              if (!review) setReview(true);
              else
                void act(
                  "feedback.reply",
                  { threadId: thread.id, body, language, notifyByEmail: notify },
                  t(
                    "The approved reply was recorded. Check email history for any notification delivery.",
                    "پاسخ تأییدشده ثبت شد. وضعیت تحویل اعلان را در تاریخچهٔ ایمیل بررسی کنید.",
                  ),
                ).then((result) => {
                  if (result) {
                    setBody("");
                    setReview(false);
                    setSource(null);
                    reload();
                  }
                });
            }}
          >
            {review
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
