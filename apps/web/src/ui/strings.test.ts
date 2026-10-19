import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fill, strings } from "./strings";

const handoff = resolve(import.meta.dirname, "../../../../docs/design/handoff-r1");

// Strings that are in neither copy.md nor a frame, each approved in HANDOFF_R1_REVIEW.md.
const APPROVED_DEVIATIONS: Record<string, string> = {
  "Skip to content": "HANDOFF_R1_REVIEW.md, item 7: accessibility.md asks for a skip link",
  "Sign out": "HANDOFF_R1_REVIEW.md, item 8: FR-ACC-002 needs sign-out; approved 2026-10-01",
  "Clear search":
    "HANDOFF_R1_REVIEW.md, item 10: names the clear button of frame A2-1b; approved 2026-10-02",
  Courses: "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
  "New session": "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
  "Record your first session. We'll help you make notes and cards from it.":
    "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
  "No sessions yet. Add your first session.":
    "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
  "No cards yet. Cards appear after a session is processed.":
    "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
  "The Terms changed on {date}. Please read and accept them to keep processing new sessions.":
    "HANDOFF_R1_REVIEW.md, item 11: D50 Course/Session naming; approved 2026-10-08",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function designCorpus(): string {
  const frames = readdirSync(handoff)
    .filter((name) => name.endsWith(".dc.html"))
    .map((name) => readFileSync(join(handoff, name), "utf8"));
  const copy = readFileSync(join(handoff, "handoff/copy.md"), "utf8");
  return decodeEntities([copy, ...frames].join("\n"));
}

function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, [...path, key]),
  );
}

describe("UI strings", () => {
  const corpus = designCorpus();

  it.each(leaves(strings))("%s comes from the design handoff", (_, value) => {
    if (value in APPROVED_DEVIATIONS) return;
    const fragments = value
      .split(/\{\w+\}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(corpus, `"${fragment}" is not in copy.md or a frame`).toContain(fragment);
    }
  });

  // PERF-06: the words live in one module per area; every area must be part of `strings`, so the
  // origin check above covers each of its strings.
  it("composes every area module into strings", async () => {
    const areas = readdirSync(import.meta.dirname).filter(
      (name) =>
        /^strings-.+\.ts$/.test(name) && name !== "strings-fill.ts" && !name.includes(".test."),
    );
    expect(areas.length).toBeGreaterThan(0);
    for (const name of areas) {
      const area: Record<string, Record<string, unknown>> = await import(
        join(import.meta.dirname, name)
      );
      expect(Object.keys(area).length, name).toBeGreaterThan(0);
      for (const [exported, groups] of Object.entries(area))
        for (const [key, group] of Object.entries(groups))
          expect((strings as Record<string, unknown>)[key], `${name}: ${exported}.${key}`).toBe(
            group,
          );
    }
  });

  it("fills placeholders and refuses a missing value", () => {
    expect(fill(strings.classStatus.partlyReady, { detail: "Part 2 missing" })).toBe(
      "Partly ready · Part 2 missing",
    );
    expect(() => fill(strings.sourceStatus.uploading, { done: 3 })).toThrow("{total}");
  });
});
