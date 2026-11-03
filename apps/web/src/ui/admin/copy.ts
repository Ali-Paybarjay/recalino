import { AdminRequestError } from "./api";
import type {
  AdminEmail,
  AdminLocale,
  AdminTask,
  AdminView,
  Dimension,
  HealthCondition,
  LocalizedText,
  PilotProgress,
  PriceRate,
  SystemHealth,
} from "./contracts";

export const viewNames: Record<AdminView, LocalizedText> = {
  overview: { en: "Overview", fa: "نمای کلی" },
  tasks: { en: "Your tasks", fa: "کارهای شما" },
  users: { en: "Users", fa: "کاربران" },
  user: { en: "User details", fa: "جزئیات کاربر" },
  pilot: { en: "Pilot capacity", fa: "ظرفیت پایلوت" },
  costs: { en: "Usage & costs", fa: "مصرف و هزینه" },
  rates: { en: "API estimates", fa: "برآورد هزینهٔ API" },
  processing: { en: "Processing", fa: "پردازش‌ها" },
  feedback: { en: "Feedback & questions", fa: "بازخورد و پرسش‌ها" },
  thread: { en: "Conversation", fa: "گفت‌وگو" },
  templates: { en: "Email templates", fa: "قالب‌های ایمیل" },
  history: { en: "Email history", fa: "تاریخچهٔ ایمیل‌ها" },
  privacy: { en: "Privacy & storage", fa: "حریم خصوصی و فایل‌ها" },
  backups: { en: "Backups", fa: "پشتیبان‌ها" },
  audit: { en: "Activity history", fa: "سابقهٔ فعالیت" },
  settings: { en: "Settings", fa: "تنظیمات" },
};
export const dimensionNames: Record<Dimension, LocalizedText> = {
  audio: { en: "Audio minutes", fa: "دقیقهٔ صوت" },
  document: { en: "Document pages", fa: "صفحهٔ سند" },
  regeneration: { en: "Regenerations", fa: "تولید مجدد" },
  tts: { en: "TTS characters", fa: "نویسهٔ گفتار" },
  storage: { en: "Storage · MiB", fa: "فضا · MiB" },
};
export const unitNames: Record<PriceRate["unit"], LocalizedText> = {
  input_million_tokens: { en: "USD / 1M input tokens", fa: "دلار / یک میلیون توکن ورودی" },
  output_million_tokens: { en: "USD / 1M output tokens", fa: "دلار / یک میلیون توکن خروجی" },
  audio_minute: { en: "USD / audio minute", fa: "دلار / دقیقهٔ صوت" },
  page: { en: "USD / page", fa: "دلار / صفحه" },
  tts_thousand_characters: { en: "USD / 1K characters", fa: "دلار / هزار نویسه" },
};
export const stageNames: Record<PriceRate["stage"], LocalizedText> = {
  generation: { en: "Notes & cards", fa: "جزوه و کارت" },
  vision: { en: "Images & documents", fa: "تصویر و سند" },
  transcription: { en: "Transcription", fa: "رونویسی" },
  tts: { en: "Speech generation", fa: "تولید گفتار" },
  support: { en: "Support replies", fa: "پاسخ پشتیبانی" },
};
/**
 * OPS-02 (audit 2026-10-18): the System health card of the owner's overview (ADM-01, ADM-12).
 * The owner approved these 16 texts word for word on 2026-10-19 (D97); they are recorded in
 * docs/design/UI_COPY_PENDING.md and approved-copy.test.ts holds the two together.
 */
export const systemHealthCopy = {
  title: { en: "System health", fa: "سلامت سامانه" },
  databaseSize: { en: "Database size", fa: "حجم دیتابیس" },
  /** {size} and {limit} are filled by systemHealthSize. */
  databaseSizeDetail: {
    en: "{size} of {limit} alert limit",
    fa: "{size} از آستانهٔ هشدار {limit}",
  },
  failedJobs: { en: "Jobs failed in the last hour", fa: "کارهای ناموفق در ساعت گذشته" },
  queueWait: { en: "Longest wait in the queue", fa: "طولانی‌ترین انتظار در صف" },
  lastRunner: { en: "Last job runner run", fa: "آخرین اجرای اجراکنندهٔ کارها" },
  schema: { en: "Database schema", fa: "نسخهٔ schema دیتابیس" },
  schemaState: {
    current: { en: "Up to date", fa: "به‌روز" },
    ahead: { en: "Newer than the app", fa: "جلوتر از اپ" },
    behind: {
      en: "A migration is missing; jobs are paused",
      fa: "یک migration اعمال نشده است؛ اجرای کارها متوقف است",
    },
    unknown: { en: "Cannot be checked", fa: "قابل بررسی نیست" },
  } satisfies Record<NonNullable<SystemHealth["schema"]>["state"], LocalizedText>,
  noAlert: {
    en: "No signal is over its threshold.",
    fa: "هیچ شاخصی از آستانه‌اش نگذشته است.",
  },
  alert: {
    database_size: {
      en: "The database is near its size limit.",
      fa: "دیتابیس به سقف حجم نزدیک است.",
    },
    failed_jobs: {
      en: "A job failed and will not retry.",
      fa: "کاری ناموفق شد و دوباره اجرا نمی‌شود.",
    },
    // P1-09: approved by the owner on 2026-11-03 (E93).
    failed_runs: {
      en: "A processing run failed in the last hour.",
      fa: "پردازشی در ساعت گذشته ناموفق شد.",
    },
    queue_delay: {
      en: "Jobs are waiting longer than expected.",
      fa: "کارها بیش از حد انتظار در صف مانده‌اند.",
    },
    runner_stale: {
      en: "The job runner has not run recently.",
      fa: "اجراکنندهٔ کارها اخیراً اجرا نشده است.",
    },
  } satisfies Record<HealthCondition, LocalizedText>,
} as const;
/** The database size row's detail: the approved sentence with both amounts filled in. */
export function systemHealthSize(size: string, limit: string, locale: AdminLocale): string {
  return systemHealthCopy.databaseSizeDetail[locale]
    .replace("{size}", () => size)
    .replace("{limit}", () => limit);
}
/**
 * PRD-03 (D96, D98): the pilot progress columns of the users list and the user details, and the
 * value of a step the learner has not reached yet. Approved word for word by the owner on
 * 2026-10-19 (docs/design/UI_COPY_PENDING.md, D98); approved-copy.test.ts holds the two together.
 */
export const pilotProgressCopy = {
  column: {
    firstSignInAt: { en: "First sign-in", fa: "نخستین ورود" },
    setupCompletedAt: { en: "Setup finished", fa: "پایان راه‌اندازی" },
    firstRecordingAt: { en: "First class audio", fa: "نخستین صوت کلاس" },
    firstProcessedAt: { en: "First session processed", fa: "نخستین جلسهٔ پردازش‌شده" },
    firstReviewAt: { en: "First review", fa: "نخستین مرور" },
  } satisfies Record<keyof PilotProgress, LocalizedText>,
  notYet: { en: "Not yet", fa: "هنوز نه" },
} as const;
/** The pilot steps in their order, for the columns and the cells. */
export const pilotProgressSteps = Object.keys(pilotProgressCopy.column) as Array<
  keyof PilotProgress
>;
/**
 * D96, D98: the titles of the stopped-deletion (`privacy`) and health-alert (`health`) tasks,
 * approved by the owner on 2026-10-19. The server sends the same titles (ADMIN_TASK_TITLE in
 * @recalino/core/ops); admin-task-copy.test.ts keeps the two identical.
 */
export const adminTaskTitleCopy = {
  privacy: { en: "Finish a stopped data deletion", fa: "تکمیل حذف داده‌ای که متوقف شده است" },
  health: { en: "Review a system health alert", fa: "بررسی هشدار سلامت سامانه" },
} as const;
/** A task's title: the approved text for the kinds above, otherwise the server's title. */
export function taskTitle(task: Pick<AdminTask, "kind" | "title">, locale: AdminLocale): string {
  return Object.hasOwn(adminTaskTitleCopy, task.kind)
    ? adminTaskTitleCopy[task.kind as keyof typeof adminTaskTitleCopy][locale]
    : localized(task.title, locale);
}
const statuses: Record<string, LocalizedText> = {
  active: { en: "Active", fa: "فعال" },
  inactive: { en: "Inactive", fa: "غیرفعال" },
  pending: { en: "Pending", fa: "در انتظار" },
  new: { en: "New", fa: "تازه" },
  open: { en: "Needs reply", fa: "نیازمند پاسخ" },
  awaiting_reply: { en: "Awaiting reply", fa: "در انتظار پاسخ" },
  needs_reply: { en: "Needs reply", fa: "نیازمند پاسخ" },
  replied: { en: "Replied", fa: "پاسخ داده شد" },
  answered: { en: "Answered", fa: "پاسخ داده شد" },
  closed: { en: "Closed", fa: "بسته" },
  draft: { en: "Draft", fa: "پیش‌نویس" },
  queued: { en: "Queued", fa: "در صف" },
  sending: { en: "Sending", fa: "در حال ارسال" },
  sent: { en: "Sent", fa: "ارسال شد" },
  delivered: { en: "Delivered", fa: "تحویل شد" },
  bounced: { en: "Bounced", fa: "برگشت خورده" },
  failed: { en: "Failed", fa: "ناموفق" },
  unknown: { en: "Unconfirmed", fa: "نامشخص" },
  not_sent: { en: "Not sent", fa: "ارسال نشده" },
  cancelled: { en: "Cancelled", fa: "لغو شده" },
  ready: { en: "Ready", fa: "آماده" },
  completed: { en: "Completed", fa: "تکمیل شد" },
  running: { en: "Running", fa: "در حال اجرا" },
  processing: { en: "Processing", fa: "در حال پردازش" },
  awaiting_upload: { en: "Awaiting upload", fa: "در انتظار بارگذاری" },
  needs_input: { en: "Needs information", fa: "نیازمند اطلاعات" },
  partial_ready: { en: "Partly ready", fa: "بخشی آماده است" },
  needs_operator: { en: "Needs administrator", fa: "نیازمند مدیر" },
  deleted: { en: "Deleted", fa: "حذف شده" },
  partial: { en: "Partly ready", fa: "تا حدی آماده" },
  pending_cleanup: { en: "Cleanup pending", fa: "پاک‌سازی در انتظار" },
  done: { en: "Done", fa: "انجام شد" },
  deferred: { en: "Deferred", fa: "به تعویق افتاده" },
  skipped: { en: "Skipped", fa: "صرف‌نظر شد" },
  question: { en: "Question", fa: "پرسش" },
  problem: { en: "Problem", fa: "مشکل" },
  suggestion: { en: "Suggestion", fa: "پیشنهاد" },
  other: { en: "Other", fa: "سایر" },
  feedback: { en: "Feedback", fa: "بازخورد" },
  needs_action: { en: "Needs action", fa: "نیازمند اقدام" },
  pending_reply: { en: "Awaiting reply", fa: "در انتظار پاسخ" },
  expired: { en: "Expired", fa: "منقضی" },
  pending_acknowledgement: { en: "Awaiting acknowledgement", fa: "در انتظار تأیید" },
  verified: { en: "Verified", fa: "تأیید شده" },
  succeeded: { en: "Completed", fa: "تکمیل شد" },
};
export function statusName(value: string, locale: AdminLocale): string {
  return statuses[value]?.[locale] ?? (locale === "fa" ? "وضعیت دیگر" : "Other state");
}
export function localized(value: string | LocalizedText, locale: AdminLocale): string {
  return typeof value === "string" ? value : value[locale];
}
export function emailDeliveryExplanation(email: AdminEmail, locale: AdminLocale): string | null {
  if (email.state === "unknown")
    return locale === "fa"
      ? "نتیجهٔ ارسال تأیید نشده است. پیش از ارسال دوباره، پوشهٔ ارسالی یا پیام برگشت در حساب فرستنده را بررسی کنید. تلاش مجدد خودکار انجام نمی‌شود."
      : "The send result is unconfirmed. Check the sender’s Sent folder or rejection notice before sending again. There is no automatic retry.";
  if (email.lastError === "smtp_authentication_rejected")
    return locale === "fa"
      ? "Gmail ورود حساب فرستنده را نپذیرفت و این ایمیل ارسال نشد. اتصال حساب Gmail فرستنده را اصلاح کنید، سپس همین ایمیل تأییدشده را دوباره ارسال کنید."
      : "Gmail rejected the sender’s sign-in, so this email was not sent. Reconnect the sender’s Gmail account, then retry this approved email.";
  return email.lastError;
}
export function errorMessage(error: unknown, locale: AdminLocale): string {
  const en = locale === "en";
  if (error instanceof AdminRequestError) {
    if (error.code === "unauthenticated")
      return en
        ? "Your session expired. Sign in again."
        : "نشست شما پایان یافته است. دوباره وارد شوید.";
    if (error.code === "forbidden")
      return en
        ? "This account does not have administrator access."
        : "این حساب دسترسی مدیریت ندارد.";
    if (error.code === "conflict" || error.code === "idempotency_mismatch")
      return en
        ? "The record changed. Refresh it and review the change again."
        : "رکورد تغییر کرده است. تازه‌سازی کنید و تغییر را دوباره بررسی کنید.";
    if (error.code === "rate_limited")
      return en ? "Please wait a moment before trying again." : "پیش از تلاش دوباره کمی صبر کنید.";
    if (error.code === "not_found")
      return en ? "This record is no longer available." : "این رکورد دیگر در دسترس نیست.";
    if (error.reasons.some((r) => /configuration|sender|email_provider/.test(r)))
      return en
        ? "Email or AI delivery is not configured. Check the service settings."
        : "ارسال ایمیل یا سرویس AI تنظیم نشده است. تنظیمات سرویس را بررسی کنید.";
    if (error.reasons.some((r) => /expired|preview/.test(r)))
      return en
        ? "The email preview expired or changed. Prepare a new preview before approving."
        : "پیش‌نمایش ایمیل منقضی شده یا تغییر کرده است. پیش‌نمایش تازه تهیه کنید.";
    if (error.code === "validation_failed")
      return en
        ? "Check the required fields, units and values before saving."
        : "فیلدهای ضروری، واحدها و مقدارها را پیش از ذخیره بررسی کنید.";
    if (error.code === "quota_insufficient")
      return en
        ? "The current capacity or budget does not allow this action."
        : "ظرفیت یا بودجهٔ فعلی اجازهٔ این عملیات را نمی‌دهد.";
  }
  return en
    ? "The request could not be completed. Your draft is preserved. Try again."
    : "درخواست انجام نشد. پیش‌نویس شما حفظ شده است. دوباره تلاش کنید.";
}
