import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// UX-06: a learner who lands on two pages with the same title and subtitle cannot tell which one
// they are on, so no two signed-in pages share a PageHeader.
const root = import.meta.dirname;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return /^(page|material-page)\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** The title and subtitle exactly as written: a quoted text, or the expression in braces. */
function headers(source: string): Array<{ title: string; subtitle: string }> {
  const prop = (block: string, name: string) => {
    const match = new RegExp(`${name}=(?:"([^"]*)"|\\{([^}]*)\\})`).exec(block);
    return match ? (match[1] ?? `{${match[2]}}`) : "";
  };
  return [...source.matchAll(/<PageHeader\b([\s\S]*?)\/>/g)].map((match) => ({
    title: prop(match[1] ?? "", "title"),
    subtitle: prop(match[1] ?? "", "subtitle"),
  }));
}

describe("PageHeader of the signed-in pages", () => {
  const found = pages(root).flatMap((path) =>
    headers(readFileSync(path, "utf8")).map((header) => ({
      ...header,
      page: relative(root, path),
    })),
  );

  it("is found on the pages the learner uses", () => {
    expect(found.length).toBeGreaterThan(15);
    const titles = found.map((header) => header.title);
    for (const title of ["Sessions", "Manage courses", "Session options"])
      expect(titles, title).toContain(title);
  });

  it("is different on every page", () => {
    const seen = new Map<string, string>();
    for (const header of found) {
      const key = `${header.title}\n${header.subtitle}`;
      expect(
        seen.get(key),
        `${header.page} repeats the header of ${seen.get(key)}`,
      ).toBeUndefined();
      seen.set(key, header.page);
    }
  });

  // A title written out in the page must be that page's own. "Record a session" is one screen,
  // opened with or without a session, and the second says which session below the title.
  it("has its own title on every page that writes the title out", () => {
    const shared = new Set(["Record a session"]);
    const byTitle = new Map<string, string>();
    for (const header of found) {
      if (header.title.startsWith("{") || shared.has(header.title)) continue;
      expect(
        byTitle.get(header.title),
        `${header.page} repeats the title "${header.title}" of ${byTitle.get(header.title)}`,
      ).toBeUndefined();
      byTitle.set(header.title, header.page);
    }
  });

  it("names the options page like the link that opens it", () => {
    const options = found.find((header) => header.page.includes("options"));
    expect(options?.title).toBe("Session options");
    const organise = found.find((header) => header.page.includes("organize"));
    expect(organise?.title).not.toBe(options?.title);
  });
});
