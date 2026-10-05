import type { EmailTemplate } from "./contracts";

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "pilot_welcome",
    version: "2026-10-05.1",
    label: {
      en: "Pilot welcome & app link",
      fa: "خوشامدگویی پایلوت و لینک اپ",
    },
    content: {
      en: {
        subject: "Welcome to Recalino, {{first_name}}",
        body: "Hello {{first_name}},\n\nYour Recalino pilot access is ready. Open the app and sign in with {{account_email}}:\n{{app_link}}\n\nWe would love to hear what helps and what needs improving. Use Feedback & help in the app to send a question or share your experience.\n\nThank you for taking part,\nThe Recalino team",
      },
      fa: {
        subject: "{{first_name}}، به ریکالینو خوش آمدید",
        body: "سلام {{first_name}}،\n\nدسترسی شما به پایلوت ریکالینو آماده است. اپ را باز کنید و با ایمیل {{account_email}} وارد شوید:\n{{app_link}}\n\nخوشحال می‌شویم بدانیم چه چیزی برایتان مفید است و چه چیزی نیاز به بهبود دارد. از بخش Feedback & help در اپ، سؤال یا تجربهٔ خود را برای ما بفرستید.\n\nاز همراهی شما سپاسگزاریم،\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "app_link", "account_email"],
  },
  {
    id: "pilot_invitation",
    version: "2026-10-05.1",
    label: {
      en: "Pilot invitation",
      fa: "دعوت به پایلوت",
    },
    content: {
      en: {
        subject: "You’re invited to try Recalino",
        body: "Hello {{first_name}},\n\nWe would like to invite you to try Recalino and help us improve learning from your classes.\n\nGet started here:\n{{app_link}}\n\n{{next_step_text}}\n\nIf you have a question, reply to this email.\n\nThe Recalino team",
      },
      fa: {
        subject: "دعوت شما برای تجربهٔ ریکالینو",
        body: "سلام {{first_name}}،\n\nاز شما دعوت می‌کنیم ریکالینو را امتحان کنید و به ما کمک کنید یادگیری از کلاس‌ها را بهتر کنیم.\n\nاز این لینک شروع کنید:\n{{app_link}}\n\n{{next_step_text}}\n\nاگر سؤالی دارید، به همین ایمیل پاسخ دهید.\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "app_link", "next_step_text"],
  },
  {
    id: "account_welcome",
    version: "2026-10-05.1",
    label: {
      en: "Account welcome & app link",
      fa: "خوشامدگویی حساب و لینک اپ",
    },
    content: {
      en: {
        subject: "Welcome to Recalino, {{first_name}}",
        body: "Hello {{first_name}},\n\nWelcome to Recalino. Open the app to finish any remaining setup and view your learning space:\n{{app_link}}\n\nIf you have a question or an idea, use Feedback & help in the app.\n\nThe Recalino team",
      },
      fa: {
        subject: "{{first_name}}، به ریکالینو خوش آمدید",
        body: "سلام {{first_name}}،\n\nبه ریکالینو خوش آمدید. برای تکمیل مراحل باقی‌ماندهٔ راه‌اندازی و دیدن فضای یادگیری خود، اپ را باز کنید:\n{{app_link}}\n\nاگر سؤال یا پیشنهادی دارید، از بخش Feedback & help در اپ برایمان پیام بفرستید.\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "app_link"],
  },
  {
    id: "feedback_thanks",
    version: "2026-10-05.1",
    label: {
      en: "Thank you for your feedback",
      fa: "تشکر بابت بازخورد",
    },
    content: {
      en: {
        subject: "Thank you for your Recalino feedback",
        body: "Hello {{first_name}},\n\nThank you for taking the time to share your experience.\n\n{{acknowledgement_text}}\n\nYou can continue the conversation here:\n{{conversation_link}}\n\nThe Recalino team",
      },
      fa: {
        subject: "از بازخورد شما دربارهٔ ریکالینو سپاسگزاریم",
        body: "سلام {{first_name}}،\n\nاز اینکه برای ارسال تجربهٔ خود وقت گذاشتید، سپاسگزاریم.\n\n{{acknowledgement_text}}\n\nاز اینجا می‌توانید گفت‌وگو را ادامه دهید:\n{{conversation_link}}\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "acknowledgement_text", "conversation_link"],
  },
  {
    id: "support_reply",
    version: "2026-10-05.1",
    label: {
      en: "Reply to a question",
      fa: "پاسخ به سؤال",
    },
    content: {
      en: {
        subject: "Re: {{conversation_subject}}",
        body: "Hello {{first_name}},\n\n{{reply_text}}\n\nYou can reply or view this conversation in Recalino:\n{{conversation_link}}\n\nThe Recalino team",
      },
      fa: {
        subject: "پاسخ: {{conversation_subject}}",
        body: "سلام {{first_name}}،\n\n{{reply_text}}\n\nاز اینجا می‌توانید پاسخ دهید یا گفت‌وگو را در ریکالینو ببینید:\n{{conversation_link}}\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "conversation_subject", "reply_text", "conversation_link"],
  },
  {
    id: "quota_updated",
    version: "2026-10-05.1",
    label: {
      en: "Allowance updated",
      fa: "تغییر سهمیه",
    },
    content: {
      en: {
        subject: "Your Recalino allowance has been updated",
        body: "Hello {{first_name}},\n\nYour allowance has been updated:\n{{quota_summary}}\n\nPeriod: {{period_text}}\n\nOpen Recalino to see your current usage:\n{{app_link}}\n\nIf anything is unclear, send us a message in Feedback & help.\n\nThe Recalino team",
      },
      fa: {
        subject: "سهمیهٔ شما در ریکالینو تغییر کرد",
        body: "سلام {{first_name}}،\n\nسهمیهٔ شما به‌روزرسانی شده است:\n{{quota_summary}}\n\nبازهٔ اعتبار: {{period_text}}\n\nبرای مشاهدهٔ مصرف فعلی، ریکالینو را باز کنید:\n{{app_link}}\n\nاگر سؤالی دارید، از بخش Feedback & help برایمان پیام بفرستید.\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "quota_summary", "period_text", "app_link"],
  },
  {
    id: "pilot_followup",
    version: "2026-10-05.1",
    label: {
      en: "Pilot feedback follow-up",
      fa: "پیگیری تجربهٔ پایلوت",
    },
    content: {
      en: {
        subject: "How is Recalino working for you?",
        body: "Hello {{first_name}},\n\nWe would love to hear how your Recalino pilot is going. What has helped you, and what has been difficult or unclear?\n\nShare your thoughts here:\n{{conversation_link}}\n\nThank you for helping us improve Recalino,\nThe Recalino team",
      },
      fa: {
        subject: "تجربهٔ شما از ریکالینو چطور بوده است؟",
        body: "سلام {{first_name}}،\n\nخوشحال می‌شویم بدانیم تجربهٔ شما از پایلوت ریکالینو چطور پیش می‌رود. چه چیزی کمک‌کننده بوده و چه چیزی دشوار یا نامشخص بوده است؟\n\nاز اینجا تجربهٔ خود را برایمان بفرستید:\n{{conversation_link}}\n\nاز اینکه به بهبود ریکالینو کمک می‌کنید، سپاسگزاریم،\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "conversation_link"],
  },
  {
    id: "pilot_complete",
    version: "2026-10-05.1",
    label: {
      en: "Pilot period ending",
      fa: "پایان دورهٔ پایلوت",
    },
    content: {
      en: {
        subject: "Your Recalino pilot period ends on {{pilot_end_date}}",
        body: "Hello {{first_name}},\n\nYour current pilot period ends on {{pilot_end_date}}.\n\n{{next_step_text}}\n\nThank you for helping us improve Recalino. You can share any final thoughts here:\n{{conversation_link}}\n\nThe Recalino team",
      },
      fa: {
        subject: "دورهٔ پایلوت شما در {{pilot_end_date}} پایان می‌یابد",
        body: "سلام {{first_name}}،\n\nدورهٔ فعلی پایلوت شما در {{pilot_end_date}} پایان می‌یابد.\n\n{{next_step_text}}\n\nاز اینکه به بهبود ریکالینو کمک کردید، سپاسگزاریم. می‌توانید تجربهٔ پایانی خود را از اینجا برایمان بفرستید:\n{{conversation_link}}\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "pilot_end_date", "next_step_text", "conversation_link"],
  },
  {
    id: "service_notice",
    version: "2026-10-05.1",
    label: {
      en: "Service update",
      fa: "اطلاع‌رسانی وضعیت سرویس",
    },
    content: {
      en: {
        subject: "Recalino service update",
        body: "Hello {{first_name}},\n\n{{issue_summary}}\n\nCurrent status: {{current_status_text}}\n\n{{user_action_text}}\n\nIf you need help, send us a message in Feedback & help.\n\nThe Recalino team",
      },
      fa: {
        subject: "اطلاع‌رسانی وضعیت سرویس ریکالینو",
        body: "سلام {{first_name}}،\n\n{{issue_summary}}\n\nوضعیت فعلی: {{current_status_text}}\n\n{{user_action_text}}\n\nاگر به کمک نیاز دارید، از بخش Feedback & help برایمان پیام بفرستید.\n\nتیم ریکالینو",
      },
    },
    requiredVariables: ["first_name", "issue_summary", "current_status_text", "user_action_text"],
  },
];
