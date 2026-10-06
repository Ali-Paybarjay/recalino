import { describe, expect, it } from "vitest";
import { automaticSourceRole } from "./roles";

describe("automatic source categories", () => {
  it("identifies audio independently of an untrusted category", () => {
    expect(automaticSourceRole("audio", { role: "user_notes", confidence: "high" })).toBe(
      "class_audio",
    );
  });
  it("accepts supported visual categories and falls back for uncertain or invalid ones", () => {
    expect(automaticSourceRole("image", { role: "board_photo", confidence: "high" })).toBe(
      "board_photo",
    );
    expect(automaticSourceRole("pdf", { role: "user_notes", confidence: "high" })).toBe(
      "user_notes",
    );
    expect(automaticSourceRole("image", { role: "user_notes", confidence: "uncertain" })).toBe(
      "class_material",
    );
    expect(automaticSourceRole("pdf", { role: "board_photo", confidence: "high" })).toBe(
      "class_material",
    );
    expect(automaticSourceRole("text", { role: "class_audio", confidence: "high" })).toBe(
      "class_material",
    );
    expect(automaticSourceRole("html")).toBe("class_material");
  });
});
