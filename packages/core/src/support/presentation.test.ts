import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../plt";
import type { EmailDraftInput } from "./contracts";
import { renderEmailRecipients } from "./email";
import { EMAIL_LOGO_VERSION, getEmailLogo } from "./email-logo";
import {
  emailPreviewHtml,
  renderEmailPresentation,
  safeEmailActionUrl,
  validateEmailPresentation,
} from "./presentation";
import { DEFAULT_EMAIL_TEMPLATES } from "./templates";

function source() {
  return {
    language: "en" as const,
    subject: "Welcome <Alex>",
    body: "Hello Alex,\n\nYour synthetic pilot is ready.\n\nThe Recalino team",
    templateId: "pilot_welcome" as const,
    presentation: {
      action: { label: "Open Recalino", url: "https://example.invalid/?one=1&two=2" },
    },
  };
}
describe("AC-ADM-008/009 branded email snapshots", () => {
  it("escapes every editable field and uses the actual app logo without remote image requests", async () => {
    const message = renderEmailPresentation({
      ...source(),
      body: '<script>steal()</script>\n\n<img src="https://untrusted.invalid">',
      presentation: {
        headline: "<h1>Title</h1>",
        preheader: "<svg onload=steal()>",
        action: { label: "<b>Open</b>", url: "https://example.invalid/?one=1&two=2" },
      },
    });
    expect(message.html).toContain("&lt;script&gt;steal()&lt;/script&gt;");
    expect(message.html).toContain("&lt;h1&gt;Title&lt;/h1&gt;");
    expect(message.html).toContain("&lt;svg onload=steal()&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html.match(/<img /g)).toHaveLength(1);
    expect(message.html).toContain('src="cid:recalino-logo-v1@recalino"');
    expect(message.html).toContain("?one=1&amp;two=2");
    const logo = getEmailLogo(message.logoVersion);
    const appLogo = await readFile(
      new URL("../../../../apps/web/public/icons/icon-192.png", import.meta.url),
    );
    expect(Buffer.from(logo.contentBase64, "base64")).toEqual(appLogo);
    expect(emailPreviewHtml(message)).toContain(
      `src="data:image/png;base64,${logo.contentBase64}"`,
    );
    expect(emailPreviewHtml(message)).not.toContain('src="cid:');
  });
  it("renders FA RTL and EN LTR with mobile and Outlook table fallbacks and readable plain text", () => {
    const en = renderEmailPresentation(source());
    // Approved v1 content must remain reproducible after future design releases.
    expect(en.checksum).toBe("23c7c638326b6a93fd124abecc83d6bc095bbfd47b0dd74fa34d10e0175b6f68");
    const fa = renderEmailPresentation({
      ...source(),
      language: "fa",
      subject: "به ریکالینو خوش آمدید",
      body: "سلام مینا،\n\nدسترسی نمونهٔ شما آماده است.\n\nتیم ریکالینو",
      presentation: { action: { label: "ورود به ریکالینو", url: "https://example.invalid" } },
    });
    expect(en.html).toContain('<html lang="en" dir="ltr">');
    expect(fa.html).toContain('<html lang="fa" dir="rtl">');
    expect(fa.html).toContain('align="right"');
    expect(en.html).toContain("max-width:600px");
    expect(en.html).toContain("<!--[if mso]>");
    expect(en.html).toContain('role="presentation"');
    expect(en.html.indexOf("Open Recalino</a>")).toBeLessThan(
      en.html.indexOf("The Recalino team</p>"),
    );
    expect(en.html).toContain('dir="ltr" style="margin:0 0 24px;');
    expect(en.text).toContain("Open Recalino: https://example.invalid");
    expect(fa.text).toContain("می‌توانید به همین ایمیل پاسخ دهید.");
    expect(fa.text.match(/تیم ریکالینو/g)).toHaveLength(1);
    expect(validateEmailPresentation(fa)).toEqual(fa);
    expect(emailPreviewHtml(en)).not.toMatch(/<a\s+href=/);
    expect(emailPreviewHtml(en)).toContain('aria-disabled="true"');
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,script",
    "http://example.invalid",
    "https://user:password@example.invalid",
    "https://example.invalid/\nattack",
    "https:\\example.invalid",
  ])("rejects unsafe CTA %s", (url) => {
    expect(() => safeEmailActionUrl(url)).toThrow();
    expect(() =>
      renderEmailPresentation({ ...source(), presentation: { action: { label: "Open", url } } }),
    ).toThrow();
  });
  it("rejects malformed, oversized and unsupported stored snapshots before previewing them", () => {
    const snapshot = renderEmailPresentation(source());
    expect(() => validateEmailPresentation({ ...snapshot, designVersion: "unknown" })).toThrow();
    expect(() => validateEmailPresentation({ ...snapshot, logoVersion: "unknown" })).toThrow();
    expect(() => getEmailLogo("unknown")).toThrow();
    expect(() =>
      validateEmailPresentation({ ...snapshot, html: `${snapshot.html}<script>steal()</script>` }),
    ).toThrow();
    const { checksum: _ignored, ...tampered } = {
      ...snapshot,
      html: snapshot.html.replace(
        "cid:recalino-logo-v1@recalino",
        "https://tracking.invalid/logo.png",
      ),
    };
    expect(() =>
      validateEmailPresentation({ ...tampered, checksum: sha256Hex(canonicalJson(tampered)) }),
    ).toThrow();
    expect(() => renderEmailPresentation({ ...source(), body: "x".repeat(24001) })).toThrow();
    expect(snapshot.logoVersion).toBe(EMAIL_LOGO_VERSION);
  });
  it("substitutes personalized visual text safely and uses both localized versions", () => {
    const template = DEFAULT_EMAIL_TEMPLATES[0];
    if (!template) throw new Error("Missing synthetic template");
    const input: EmailDraftInput = {
      operationKey: randomUUID(),
      recipients: [
        { userId: randomUUID(), email: "en@example.invalid", firstName: "<Alex>", language: "en" },
        { userId: randomUUID(), email: "fa@example.invalid", firstName: "مینا", language: "fa" },
      ],
      templateId: "pilot_welcome",
      language: "recipient",
      variables: { app_link: "https://example.invalid" },
      localizedPresentation: {
        en: {
          headline: "Hello {{first_name}}",
          preheader: "Ready for {{account_email}}",
          action: { label: "Open {{first_name}}", url: "{{app_link}}" },
        },
        fa: { headline: "سلام {{first_name}}", action: null },
      },
      reason: "Synthetic branded preview",
    };
    const [en, fa] = renderEmailRecipients(input, template);
    expect(en?.presentation?.headline).toBe("Hello <Alex>");
    expect(en?.presentation?.html).toContain("Hello &lt;Alex&gt;");
    expect(en?.presentation?.action?.label).toBe("Open <Alex>");
    expect(fa?.presentation?.headline).toBe("سلام مینا");
    expect(fa?.presentation?.action).toBeNull();
    input.localizedPresentation = {
      en: { headline: "{{missing2}}", action: { label: "Go", url: "{{missing_link}}" } },
    };
    expect(renderEmailRecipients(input, template)[0]?.missingVariables).toEqual([
      "missing2",
      "missing_link",
    ]);
  });
});
