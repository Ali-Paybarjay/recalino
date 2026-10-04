import { describe, expect, it } from "vitest";
import { buildSampleHtml, escapeSampleHtml } from "./LearningViews";

const all = { examples: true, explanation: true, practice: true, sources: true };

describe("sample HTML export", () => {
  it("keeps a learner's text as text, including attempted active HTML", () => {
    const html = buildSampleHtml(
      "My class",
      '</p><script>alert("x")</script><img src=x onerror=alert(1)>',
      3,
      all,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
  });

  it("escapes title content so it cannot close the title element", () => {
    const html = buildSampleHtml("</title><script>bad</script>", "My notes", 2, all);
    expect(html).toContain("&lt;/title&gt;");
    expect(html).not.toContain("<script>");
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it("excludes optional content when the learner deselects it", () => {
    const html = buildSampleHtml("My class", "My own notes", 4, {
      examples: false,
      explanation: false,
      practice: false,
      sources: false,
    });
    expect(html).toContain("My own notes");
    expect(html).not.toContain("<blockquote>");
    expect(html).not.toContain("<details>");
    expect(html).not.toContain("<ul>");
    expect(html).not.toContain("AI explanation");
  });

  it("creates a standalone version snapshot without external resources or original media", () => {
    const html = buildSampleHtml("A & B", "First line\nSecond line", 7, all);
    expect(html).toContain("Version 7 snapshot");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("First line\nSecond line");
    expect(html).not.toMatch(/<script|<link|<audio|<iframe|https?:\/\//i);
  });

  it("escapes all HTML-sensitive characters, without changing other scripts", () => {
    expect(escapeSampleHtml("فارسی & < > \" '")).toBe("فارسی &amp; &lt; &gt; &quot; &#39;");
  });
});
