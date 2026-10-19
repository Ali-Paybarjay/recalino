import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NotificationInvite } from "./NotificationInvite";

// UX-13 (owner text of 2026-10-19): only the browser can tell whether it can still be asked, so the
// server render never offers the invite and it cannot flash for a learner who already chose.
it("is not part of the server render", () => {
  expect(renderToStaticMarkup(createElement(NotificationInvite))).toBe("");
});
