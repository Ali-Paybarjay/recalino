import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unitCopy } from "../course-copy";
import { InfoTip } from "./InfoTip";

describe("InfoTip (D52)", () => {
  it("starts closed with a named button that controls the hidden help text", () => {
    const html = renderToStaticMarkup(
      createElement(
        InfoTip,
        // Children come as the third argument, as in JSX.
        { label: unitCopy.helpLabel } as ComponentProps<typeof InfoTip>,
        createElement("p", null, "Help"),
      ),
    );
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(html).toContain('aria-label="About units"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('type="button"');
    expect(controlled).toBeDefined();
    expect(html).toMatch(new RegExp(`<div[^>]*id="${controlled}"[^>]*hidden=""`));
    expect(html).toContain("<p>Help</p>");
  });
});
