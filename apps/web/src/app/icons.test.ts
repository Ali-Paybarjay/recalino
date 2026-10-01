import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// HANDOFF §0 and §5c: the app icons are copied verbatim, never edited. Change them only by taking
// a new handoff from Claude Design and copying the files again.
const handoff = resolve(import.meta.dirname, "../../../../docs/design/handoff-r1/recalino/icons");
const icons = resolve(import.meta.dirname, "../../public/icons");
const served = readdirSync(icons);

describe("app icons", () => {
  it.each(served)("%s is a byte-for-byte copy of the handoff", (name) => {
    const ours = readFileSync(resolve(icons, name));
    const theirs = readFileSync(resolve(handoff, name));
    expect(ours.equals(theirs)).toBe(true);
  });

  it("the manifest lists only icons that are served", () => {
    for (const icon of manifest().icons ?? []) {
      expect(served).toContain(icon.src.replace("/icons/", ""));
    }
  });
});
