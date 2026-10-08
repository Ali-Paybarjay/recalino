import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { reviewVoiceCopy } from "./review-voice-copy";

const register = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/design/UI_COPY_2026-10-08.md"),
  "utf8",
);

function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, [...path, key]),
  );
}

// D48: the approved wording is used verbatim; any edit must go back through the register.
it.each(leaves(reviewVoiceCopy))("%s matches its approved register entry", (key, text) => {
  expect(register).toContain(`\`${key}\``);
  expect(register).toContain(text);
});
