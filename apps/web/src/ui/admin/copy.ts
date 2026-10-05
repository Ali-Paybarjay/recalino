import { AdminRequestError } from "./api";
import type { AdminLocale, AdminView, Dimension, LocalizedText, PriceRate } from "./contracts";

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
  unknown: { en: "Checking status", fa: "در حال بررسی وضعیت" },
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
