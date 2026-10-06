import { randomUUID } from "node:crypto";
import { parse } from "parse5";
import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { syntheticKnowledge } from "../../test/study-fixture";
import { renderClassNotesHtml } from "../lkm";
import { renderNotebookHtml } from "./render";

it("renders passive self-contained text with CSP, native exercises and immutable revision labels", () => {
  const model = syntheticKnowledge();
  model.title = 'فارسی <script src="https://evil.test/x">';
  const summary = model.summary[0];
  if (!summary) throw new Error("Missing fixture claim");
  summary.text = '<img onerror="alert(1)" src="https://evil.test/y">';
  model.language.explanation = "fa";
  const value = new TextDecoder().decode(
    renderNotebookHtml({
      revisionId: randomUUID(),
      revisionNumber: 4,
      createdAt: "2026-10-04",
      model,
    }),
  );
  expect(value).toContain('dir="rtl"');
  expect(value).toContain("&lt;script");
  expect(value).toContain("&lt;img onerror");
  expect(value).toContain("Content-Security-Policy");
  expect(value).toContain("<details>");
  expect(value).toContain("Revision 4");
  const document = parse(value);
  const tags: string[] = [];
  function visit(node: { nodeName: string; childNodes?: unknown[] }) {
    tags.push(node.nodeName);
    for (const child of node.childNodes ?? []) visit(child as typeof node);
  }
  visit(document);
  expect(tags).not.toContain("script");
  expect(tags).not.toContain("iframe");
  expect(tags).not.toContain("img");
  expect(tags).not.toContain("form");
});

it("downloads exactly the same reference document as the frame and preserves requested media", () => {
  const model = referenceStudyModel();
  const input = { revisionId: randomUUID(), revisionNumber: 2, model, createdAt: "2026-10-05" };
  expect(new TextDecoder().decode(renderNotebookHtml(input))).toBe(renderClassNotesHtml(model));
  const image = {
    media: {
      id: "image",
      sessionId: "session",
      objectId: "object",
      sourceId: null,
      kind: "image" as const,
      mimeType: "image/png",
      byteLength: 3,
    },
    bytes: new Uint8Array([1, 2, 3]),
  };
  const withMedia = new TextDecoder().decode(renderNotebookHtml(input, [image]));
  expect(withMedia).toContain('id="selected-images"');
  expect(withMedia).toContain('src="data:image/png;base64,AQID"');
  expect(withMedia).toContain('id="core"');
});
