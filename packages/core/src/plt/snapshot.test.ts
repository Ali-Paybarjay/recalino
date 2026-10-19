import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { parseSnapshot, storedObject } from "./snapshot";

describe("stored snapshot reads (QUA-05)", () => {
  const schema = z.looseObject({ id: z.string(), nested: storedObject<{ title: string }>() });
  it("returns a valid snapshot unchanged, including keys the schema does not check", () => {
    const stored = { id: "a", nested: { title: "Synthetic", extra: [1] }, written: "v1" };
    expect(parseSnapshot(schema, stored)).toEqual(stored);
  });
  it("turns an incomplete snapshot into a controlled internal error", () => {
    for (const stored of [null, "text", {}, { id: "a" }, { id: "a", nested: [] }]) {
      let error: unknown;
      try {
        parseSnapshot(schema, stored);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "internal", status: 500, reason: "snapshot_invalid" });
    }
  });
});
