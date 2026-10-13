import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MissingAudioNotice, partMissingLabel } from "./MissingAudioNotice";

describe("missing audio notice after Stop (PRD-REC-03)", () => {
  it("says how much was not recorded and when, without rendering for a complete capture", () => {
    expect(renderToStaticMarkup(createElement(MissingAudioNotice, { missing: null }))).toBe("");
    const html = renderToStaticMarkup(
      createElement(MissingAudioNotice, {
        missing: {
          totalMs: 28 * 60000 + 7000,
          intervals: [
            { from: "2026-10-12T08:49:05.000Z", missingMs: 28 * 60000 },
            { from: "2026-10-12T09:30:00.000Z", missingMs: 7000 },
          ],
        },
      }),
    );
    expect(html).toContain("Part of this class was not recorded: about 29 min in total.");
    expect(html).toContain("About 28 min missing from");
    expect(html).toContain("About 1 min missing from");
    expect(html).toContain('role="alert"');
    expect(partMissingLabel(61000)).toBe("2 min not recorded");
  });
});
