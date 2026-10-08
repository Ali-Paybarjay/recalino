import { z } from "zod";
import { canonicalJson, errors, sha256Hex } from "../plt";
import type {
  EmailPresentationInput,
  EmailPresentationSnapshot,
  EmailTemplateId,
  SupportLocale,
} from "./contracts";
import { EMAIL_LOGO_CID, EMAIL_LOGO_VERSION, getEmailLogo } from "./email-logo";

export const EMAIL_DESIGN_VERSION = "recalino-email-2026-10-06.1";
const SUPPORT_EMAIL = "recalino.pilot@gmail.com";

/** Only HTTPS web destinations are allowed. Credentials, controls and non-web schemes are rejected. */
export function safeEmailActionUrl(value: string): string {
  try {
    if (
      value.length > 2048 ||
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
      )
    )
      throw new Error("unsafe_email_action_url");
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
      throw new Error("unsafe_email_action_url");
    return url.href;
  } catch {
    throw errors.validationFailed({ presentation: ["https_action_url_required"] });
  }
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}
export function emailVariant(
  templateId: EmailTemplateId | null,
): EmailPresentationSnapshot["variant"] {
  if (
    templateId === "pilot_welcome" ||
    templateId === "pilot_invitation" ||
    templateId === "account_welcome"
  )
    return "welcome";
  if (
    templateId === "support_reply" ||
    templateId === "feedback_thanks" ||
    templateId === "pilot_followup"
  )
    return "conversation";
  return "notice";
}
export function defaultEmailAction(
  templateId: EmailTemplateId | null,
  locale: SupportLocale,
  variables: Record<string, string>,
): { label: string; url: string } | null {
  if (!templateId || templateId === "service_notice") return null;
  const conversation = [
    "feedback_thanks",
    "support_reply",
    "pilot_followup",
    "pilot_complete",
  ].includes(templateId);
  const url = variables[conversation ? "conversation_link" : "app_link"];
  if (!url || /\{\{/.test(url)) return null;
  return {
    label: conversation
      ? locale === "fa"
        ? "مشاهدهٔ گفت‌وگو"
        : "View conversation"
      : locale === "fa"
        ? "ورود به ریکالینو"
        : "Open Recalino",
    url: safeEmailActionUrl(url),
  };
}

type FrozenSource = Pick<
  EmailPresentationSnapshot,
  "variant" | "language" | "headline" | "preheader" | "action" | "body"
>;
/** Immutable v1 renderer. Future designs must add a new renderer/version, never edit approved v1 output. */
function renderV1(source: FrozenSource): { html: string; text: string } {
  const fa = source.language === "fa";
  const direction = fa ? "rtl" : "ltr";
  const align = fa ? "right" : "left";
  const font = fa ? "Tahoma, Arial, sans-serif" : "Arial, Helvetica, sans-serif";
  const label = fa
    ? { welcome: "به ریکالینو خوش آمدید", conversation: "در کنار شما", notice: "تازه‌های ریکالینو" }[
        source.variant
      ]
    : { welcome: "WELCOME TO RECALINO", conversation: "HERE TO HELP", notice: "RECALINO UPDATE" }[
        source.variant
      ];
  const reply = fa ? "می‌توانید به همین ایمیل پاسخ دهید." : "You can reply directly to this email.";
  const signature = fa ? "تیم ریکالینو" : "The Recalino team";
  const hasSignature = /(?:The Recalino team|تیم ریکالینو)\s*$/i.test(source.body);
  // Keep the editor source untouched. A stand-alone CTA URL need not appear twice in the visual email.
  let visualBody = source.action
    ? source.body
        .split("\n")
        .filter((line) => {
          if (!line.trim().startsWith("https://")) return true;
          try {
            return safeEmailActionUrl(line.trim()) !== source.action?.url;
          } catch {
            return true;
          }
        })
        .join("\n")
    : source.body;
  const trailingSignature = /(?:^|\r?\n)(The Recalino team|تیم ریکالینو)\s*$/i;
  const visualSignature = visualBody.match(trailingSignature)?.[1] ?? signature;
  visualBody = visualBody.replace(trailingSignature, "").trim();
  const paragraphs = visualBody
    .split(/\r?\n\s*\r?\n/)
    .filter((part) => part.trim())
    .map(
      (part) =>
        `<p style="margin:0 0 20px;font-family:${font};font-size:16px;line-height:1.75;color:#13261f;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(part.trim()).replace(/\r?\n/g, "<br>")}</p>`,
    )
    .join("");
  const action = source.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:8px 0 12px;"><tr><td align="${align}"><table role="presentation" align="${align}" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#13261f" style="border-radius:12px;text-align:center;mso-padding-alt:16px 28px;"><a href="${escapeHtml(source.action.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 28px;font-family:${font};font-size:16px;font-weight:bold;line-height:1.25;text-decoration:none;color:#eef9f3;background-color:#13261f;border-radius:12px;">${escapeHtml(source.action.label)}</a></td></tr></table></td></tr></table><p dir="ltr" style="margin:0 0 24px;text-align:${align};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.75;overflow-wrap:anywhere;word-break:break-word;"><a href="${escapeHtml(source.action.url)}" style="color:#0d7556;text-decoration:underline;">${escapeHtml(source.action.url)}</a></p>`
    : "";
  const signatureHtml = `<p style="margin:0 0 20px;font-size:16px;line-height:1.75;color:#0d7556;font-weight:bold;">${escapeHtml(visualSignature)}</p>`;
  const html = `<!doctype html><html lang="${source.language}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(source.headline)}</title><style>@media only screen and (max-width:600px){.rc-shell{width:100%!important}.rc-outer{padding:16px 8px!important}.rc-content{padding:28px 24px!important}.rc-headline{font-size:24px!important}}</style></head><body style="margin:0;padding:0;width:100%;background-color:#eef9f3;color:#13261f;font-family:${font};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(source.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef9f3"><tr><td class="rc-outer" align="center" style="padding:32px 16px;"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table class="rc-shell" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;"><tr><td style="padding:0 8px 24px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" dir="ltr"><tr><td width="48" valign="middle"><img src="cid:${EMAIL_LOGO_CID}" alt="Recalino" width="48" height="48" style="display:block;border:0;border-radius:14px;"></td><td valign="middle" style="padding-left:14px;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:25px;font-weight:bold;letter-spacing:-0.6px;color:#13261f;">Recalino</td></tr></table></td></tr><tr><td bgcolor="#fbfffd" style="border:1px solid #b6d7c8;border-radius:20px;overflow:hidden;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${direction}"><tr><td class="rc-content" align="${align}" bgcolor="#d9f2e5" style="padding:32px;border-radius:20px 20px 0 0;text-align:${align};direction:${direction};"><p style="margin:0 0 14px;font-size:12px;line-height:1.5;font-weight:bold;letter-spacing:${fa ? "0" : "1.2px"};color:#0d7556;">${label}</p><h1 class="rc-headline" style="margin:0;font-family:${font};font-size:28px;line-height:1.45;font-weight:bold;letter-spacing:-0.5px;color:#13261f;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(source.headline)}</h1><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${align}" style="margin-top:22px;"><tr><td width="64" height="5" bgcolor="#b9f06b" style="font-size:1px;line-height:1px;border-radius:4px;">&nbsp;</td></tr></table></td></tr><tr><td class="rc-content" align="${align}" style="padding:32px 32px 24px;text-align:${align};direction:${direction};">${paragraphs}${action}${signatureHtml}</td></tr></table></td></tr><tr><td align="${align}" dir="${direction}" style="padding:24px 8px 8px;text-align:${align};font-family:${font};font-size:13px;line-height:1.75;color:#4a6259;"><p style="margin:0 0 4px;">${reply}</p><a href="mailto:${SUPPORT_EMAIL}" style="color:#0d7556;text-decoration:underline;direction:ltr;unicode-bidi:embed;">${SUPPORT_EMAIL}</a><p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#4a6259;">Recalino</p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  const textParts = [source.headline, source.body];
  if (source.action && !source.body.includes(source.action.url))
    textParts.push(`${source.action.label}: ${source.action.url}`);
  if (!hasSignature) textParts.push(signature);
  textParts.push(reply, SUPPORT_EMAIL);
  return { html, text: textParts.join("\n\n") };
}
const sourceSchema = z.strictObject({
  variant: z.enum(["welcome", "conversation", "notice"]),
  language: z.enum(["en", "fa"]),
  headline: z.string().trim().min(1).max(300),
  preheader: z.string().max(200),
  action: z
    .strictObject({ label: z.string().trim().min(1).max(100), url: z.string().max(2048) })
    .nullable(),
  body: z.string().min(1).max(24000),
});
const snapshotSchema = sourceSchema.extend({
  designVersion: z.literal(EMAIL_DESIGN_VERSION),
  logoVersion: z.literal(EMAIL_LOGO_VERSION),
  html: z.string().min(1).max(190000),
  text: z.string().min(1).max(28000),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
function checksum(value: Omit<EmailPresentationSnapshot, "checksum">): string {
  return sha256Hex(canonicalJson(value));
}
export function renderEmailPresentation(value: {
  language: SupportLocale;
  subject: string;
  body: string;
  templateId: EmailTemplateId | null;
  presentation?: EmailPresentationInput;
}): EmailPresentationSnapshot {
  const source = sourceSchema.parse({
    variant: emailVariant(value.templateId),
    language: value.language,
    headline: value.presentation?.headline ?? value.subject,
    preheader: value.presentation?.preheader ?? value.body.replace(/\s+/g, " ").slice(0, 160),
    action: value.presentation?.action ?? null,
    body: value.body,
  });
  if (source.action) source.action.url = safeEmailActionUrl(source.action.url);
  const snapshot = {
    ...source,
    designVersion: EMAIL_DESIGN_VERSION,
    logoVersion: EMAIL_LOGO_VERSION,
    ...renderV1(source),
  };
  return snapshotSchema.parse({ ...snapshot, checksum: checksum(snapshot) });
}
/** Validate frozen content against its exact supported renderer, never regenerate it with today's design. */
export function validateEmailPresentation(value: unknown): EmailPresentationSnapshot {
  const snapshot = snapshotSchema.parse(value);
  if (snapshot.action && safeEmailActionUrl(snapshot.action.url) !== snapshot.action.url)
    throw new Error("invalid_email_presentation");
  const rendered = renderV1(
    sourceSchema.parse({
      variant: snapshot.variant,
      language: snapshot.language,
      headline: snapshot.headline,
      preheader: snapshot.preheader,
      action: snapshot.action,
      body: snapshot.body,
    }),
  );
  const { checksum: storedChecksum, ...content } = snapshot;
  if (
    storedChecksum !== checksum(content) ||
    snapshot.html !== rendered.html ||
    snapshot.text !== rendered.text
  )
    throw new Error("invalid_email_presentation");
  return snapshot;
}
/** Preview alone embeds the same trusted PNG; the outgoing HTML retains its versioned CID attachment. */
export function emailPreviewHtml(value: unknown): string {
  const snapshot = validateEmailPresentation(value);
  const logo = getEmailLogo(snapshot.logoVersion);
  return snapshot.html
    .replace(`src="cid:${logo.cid}"`, `src="data:${logo.contentType};base64,${logo.contentBase64}"`)
    .replace(
      /<a href="([^"]+)"/g,
      '<a role="link" aria-disabled="true" tabindex="-1" data-preview-href="$1"',
    );
}
