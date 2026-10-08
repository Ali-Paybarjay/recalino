import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListPicker, type PickerOption } from "./ListPicker";

function render(options: readonly PickerOption[]) {
  return renderToStaticMarkup(
    createElement(ListPicker, {
      label: "First language",
      placeholder: "Search languages",
      options,
      value: null,
      onChange: () => undefined,
      emptyText: "No language matches.",
    }),
  );
}

describe("ListPicker accessible references", () => {
  it("keeps the controlled listbox in the document before options arrive", () => {
    const html = render([]);
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1];
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(controlled).toBeDefined();
    expect(ids).toContain(controlled);
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain("aria-activedescendant");
    expect(html).toContain("No language matches.");
  });

  it("references a rendered option once options are available", () => {
    const html = render([{ id: "fa", label: "Persian — فارسی", search: "persian فارسی" }]);
    const active = html.match(/aria-activedescendant="([^"]+)"/)?.[1];
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(active).toBeDefined();
    expect(ids).toContain(active);
    expect(html).toContain('role="option"');
  });
});
