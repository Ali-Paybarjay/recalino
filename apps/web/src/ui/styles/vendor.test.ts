import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// HANDOFF §0: the design CSS is copied verbatim, never edited. Change it only by taking a new
// handoff from Claude Design and copying the file again.
const handoff = resolve(import.meta.dirname, "../../../../../docs/design/handoff-r1");

const COPIES = [
  ["vendor/nocturne-base.css", "handoff/css/nocturne-base.css"],
  ["vendor/tokens.css", "recalino/tokens.css"],
] as const;

describe("design CSS", () => {
  it.each(COPIES)("%s is a byte-for-byte copy of the handoff", (copy, original) => {
    const ours = readFileSync(resolve(import.meta.dirname, copy));
    const theirs = readFileSync(resolve(handoff, original));
    expect(ours.equals(theirs)).toBe(true);
  });
});
