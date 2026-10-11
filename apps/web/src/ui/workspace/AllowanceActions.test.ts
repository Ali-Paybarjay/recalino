import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AllowanceActions } from "./AllowanceActions";
import type { AutomaticLearningStatus } from "./automatic-learning";

const amounts = (document: number) => ({
  audio: 0,
  document,
  regeneration: 0,
  tts: 0,
  storage: 0,
});
const blocked: AutomaticLearningStatus = {
  state: "blocked",
  revision: 2,
  batchId: null,
  run: null,
  snapshot: null,
  lastError: "quota_insufficient",
  message: "Your material is saved.",
  notesReady: false,
  cardsReady: false,
};
const render = (status: AutomaticLearningStatus | null) =>
  renderToStaticMarkup(createElement(AllowanceActions, { status, busy: false, onRetry: vi.fn() }));

describe("allowance actions without an upload receipt", () => {
  it("FR-QUOTA-007: a known shortage asks for more allowance and links the allowance", () => {
    const html = render({
      ...blocked,
      allowance: { active: true, required: amounts(2), available: amounts(1) },
    });
    expect(html).toMatch(/href="\/help\/new"[^>]*>Ask for more allowance<\/a>/);
    expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
    expect(html).not.toContain("Retry processing");
  });

  it("FR-QUOTA-003: a missing allowance asks the pilot operator", () => {
    const html = render({
      ...blocked,
      allowance: { active: false, required: amounts(1), available: amounts(0) },
    });
    expect(html).toMatch(/href="\/help\/new"[^>]*>Ask the pilot operator<\/a>/);
    expect(html).not.toContain("Ask for more allowance");
    expect(html).toMatch(/href="\/me\/quota"[^>]*>Review allowance<\/a>/);
  });

  it("FR-QUOTA-007 rule 5: an allowance that now covers the class offers only the retry", () => {
    const html = render({
      ...blocked,
      allowance: { active: true, required: amounts(1), available: amounts(1) },
    });
    expect(html).toContain("Retry processing");
    expect(html).not.toContain("/help/new");
    expect(html).not.toContain("Review allowance");
  });

  it("names nothing for other stops or a class that is not blocked", () => {
    expect(render({ ...blocked, lastError: "provider_output_truncated" })).toBe("");
    expect(render({ ...blocked, state: "processing", lastError: null })).toBe("");
    expect(render(null)).toBe("");
  });
});
