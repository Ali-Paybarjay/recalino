import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { pendingCopy } from "./pending-copy";

const register = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/design/UI_COPY_PENDING.md"),
  "utf8",
);

function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, [...path, key]),
  );
}

// Text outside the design handoff must be visible to the product owner, never silently inline.
it.each(leaves(pendingCopy))("%s is registered verbatim for owner approval", (key, text) => {
  expect(register).toContain(`\`${key}\``);
  expect(register).toContain(text);
});

// The register lists only text that is still pending, so an approved row cannot linger there.
it("lists no key in the register that is not pending", () => {
  const pending = new Set(leaves(pendingCopy).map(([key]) => key));
  const listed = [...register.matchAll(/^\| `([\w.]+)` \|/gm)].map((match) => match[1]);
  expect(listed.filter((key) => !pending.has(key ?? ""))).toEqual([]);
});
