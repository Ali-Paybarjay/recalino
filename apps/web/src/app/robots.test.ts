import { describe, expect, it } from "vitest";
import { metadata } from "./layout";
import robots from "./robots";

// PRD-04: the private pilot is not offered to search engines.
describe("search engine exposure", () => {
  it("disallows every path for every crawler", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("marks every page noindex and nofollow from the root layout", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
