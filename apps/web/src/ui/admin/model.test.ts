import { describe, expect, it } from "vitest";
import type { PriceRate } from "./contracts";
import {
  availableQuota,
  dollarsToMicros,
  emailBodyWithNote,
  exactQuotaUnits,
  formatMegabytes,
  formatWait,
  friendlyQuotaUnits,
  manualTemplateVariables,
  parseQuota,
  type QuotaUnitConfig,
  quotaFields,
  rateConfigurationProblem,
  readableTemplateText,
  switchQuotaFieldUnit,
} from "./model";

describe("admin allocations (AC-ADM-014..018)", () => {
  it("accepts independent allocations beyond presets and converts exact units", () => {
    expect(
      parseQuota({
        audio: "2000",
        document: "300",
        regeneration: "100",
        tts: "200000",
        storage: "1536",
      }),
    ).toEqual({
      audio: 120000,
      document: 300,
      regeneration: 100,
      tts: 200000,
      storage: 1610612736,
    });
    expect(
      parseQuota({ audio: "0", document: "0", regeneration: "0", tts: "0", storage: "0" }),
    ).toEqual({ audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 });
  });
  it("rejects unsafe, nonfinite, negative, blank and fractional count values", () => {
    const base = {
      audio: "600",
      document: "100",
      regeneration: "20",
      tts: "20000",
      storage: "500",
    };
    for (const document of ["", "-1", "1.5", "Infinity", "NaN", "9007199254740992"])
      expect(parseQuota({ ...base, document })).toBeNull();
    expect(parseQuota({ ...base, audio: "0.001" })).toBeNull();
  });
  it("shows zero available after a reduction while keeping usage and reservations distinct", () => {
    expect(availableQuota(100, 120, 30)).toBe(0);
    expect(availableQuota(800, 120, 30)).toBe(650);
    expect(
      quotaFields({ audio: 36000, document: 100, regeneration: 20, tts: 20000, storage: 524288000 })
        .storage,
    ).toBe("500");
  });
  it("round-trips 31 seconds in minutes without admitting fractional seconds", () => {
    const amounts = { audio: 31, document: 1, regeneration: 1, tts: 1, storage: 31 };
    expect(parseQuota(quotaFields(amounts))).toEqual(amounts);
    expect(parseQuota({ ...quotaFields(amounts), audio: "0.001" })).toBeNull();
    expect(parseQuota({ ...quotaFields(amounts), audio: "0.000000000000000001" })).toBeNull();
  });
  it("accepts exact MAX_SAFE base units and prevents overflow or fractional base units", () => {
    const exact: QuotaUnitConfig = { audio: "seconds", storage: "bytes" };
    const amounts = {
      audio: Number.MAX_SAFE_INTEGER,
      document: 1,
      regeneration: 1,
      tts: 1,
      storage: Number.MAX_SAFE_INTEGER,
    };
    const fields = quotaFields(amounts, exact);
    expect(fields.audio).toBe("9007199254740991");
    expect(fields.storage).toBe("9007199254740991");
    expect(parseQuota(fields, exact)).toEqual(amounts);
    for (const audio of ["9007199254740992", "Infinity", "1.5"])
      expect(parseQuota({ ...fields, audio }, exact)).toBeNull();
    expect(parseQuota({ ...fields, storage: "9007199254740992" }, exact)).toBeNull();
    expect(parseQuota({ ...fields, storage: "1.5" }, exact)).toBeNull();
    expect(parseQuota(quotaFields(amounts))).toBeNull();
    const selected = exactQuotaUnits(amounts);
    expect(selected.audio).toBe("seconds");
    expect(parseQuota(quotaFields(amounts, selected), selected)).toEqual(amounts);
  });
  it("preserves canonical values through valid toggles and refuses a lossy conversion", () => {
    const exact: QuotaUnitConfig = { audio: "seconds", storage: "bytes" };
    const minutes = switchQuotaFieldUnit("31", "audio", exact, friendlyQuotaUnits);
    expect(minutes).toBe(String(31 / 60));
    expect(switchQuotaFieldUnit(minutes ?? "", "audio", friendlyQuotaUnits, exact)).toBe("31");
    const mib = switchQuotaFieldUnit("31", "storage", exact, friendlyQuotaUnits);
    expect(switchQuotaFieldUnit(mib ?? "", "storage", friendlyQuotaUnits, exact)).toBe("31");
    expect(switchQuotaFieldUnit("9007199254740991", "audio", exact, friendlyQuotaUnits)).toBeNull();
    expect(switchQuotaFieldUnit("", "audio", friendlyQuotaUnits, exact)).toBeNull();
    const preset = { audio: 36000, document: 10, regeneration: 2, tts: 300, storage: 524288000 };
    expect(quotaFields(preset, exact)).toMatchObject({ audio: "36000", storage: "524288000" });
    expect(exactQuotaUnits(preset, exact)).toEqual(exact);
  });
});
describe("admin cost units", () => {
  it("keeps USD amounts exact in micros and rejects invalid precision", () => {
    expect(dollarsToMicros("0.006")).toBe(6000);
    expect(dollarsToMicros("50")).toBe(50000000);
    for (const value of ["", "-1", "Infinity", "0.0000001"])
      expect(dollarsToMicros(value)).toBeNull();
  });
  it("allows paired token prices while refusing ambiguous or duplicate billing rows", () => {
    const input: PriceRate = {
      id: "in",
      stage: "generation",
      model: "same-model",
      unit: "input_million_tokens",
      rateMicros: 500000,
    };
    const output: PriceRate = { ...input, id: "out", unit: "output_million_tokens" };
    const page: PriceRate = { ...input, id: "page", unit: "page" };
    expect(rateConfigurationProblem([input, output])).toBeNull();
    expect(rateConfigurationProblem([input, page])).toBe("ambiguous");
    expect(
      rateConfigurationProblem([input, { ...input, id: "second", model: " same-model " }]),
    ).toBe("duplicate");
    expect(rateConfigurationProblem([input, { ...page, model: "different-model" }])).toBeNull();
  });
});
describe("routine email variables", () => {
  it("exposes missing owner text in subject/body while leaving trusted account values to the server", () => {
    expect(
      manualTemplateVariables(
        "{{first_name}}: {{ issue_summary }}",
        "{{app_link}} {{issue_summary}} {{next_step_text}} {{account_email}} {{period_text}} {{custom_note}} {{pilot_end_date}}",
      ),
    ).toEqual(["issue_summary", "next_step_text", "custom_note"]);
    expect(manualTemplateVariables("Plain subject", "Plain message")).toEqual([]);
  });
  it("treats only the selected template's ready nonempty details as optional", () => {
    expect(
      manualTemplateVariables("Invitation", "{{next_step_text}} {{custom_note}}", {
        next_step_text: "Open the app to begin.",
      }),
    ).toEqual(["custom_note"]);
    expect(
      manualTemplateVariables("Invitation", "{{next_step_text}}", { next_step_text: " " }),
    ).toEqual(["next_step_text"]);
    expect(
      manualTemplateVariables("Custom", "{{reply_text}} {{next_step_text}}", {
        acknowledgement_text: "Thank you.",
      }),
    ).toEqual(["reply_text", "next_step_text"]);
  });
  it("shows ready routine paragraphs without substituting private recipient details", () => {
    expect(
      readableTemplateText("Hello {{first_name}}\n{{ next_step_text }}\n{{app_link}}", {
        next_step_text: "Open the app to begin.",
      }),
    ).toBe("Hello {{first_name}}\nOpen the app to begin.\n{{app_link}}");
    expect(readableTemplateText("{{reply_text}}", { acknowledgement_text: "Thank you." })).toBe(
      "{{reply_text}}",
    );
  });
  it("puts optional notes above the existing English or Persian sign-off without replacing the message", () => {
    expect(
      emailBodyWithNote("Hello\n\nThank you,\nThe Recalino team", "  Personal detail.  "),
    ).toBe("Hello\n\nPersonal detail.\n\nThank you,\nThe Recalino team");
    expect(emailBodyWithNote("سلام\n\nتیم ریکالینو", "یادداشت شخصی")).toBe(
      "سلام\n\nیادداشت شخصی\n\nتیم ریکالینو",
    );
    expect(emailBodyWithNote("A custom message.", "Extra detail.")).toBe(
      "A custom message.\n\nExtra detail.",
    );
    expect(emailBodyWithNote("Hello\n\nThe Recalino team", " ")).toBe("Hello\n\nThe Recalino team");
  });
});

// OPS-02: the System health card shows amounts with the locale's own units, never new copy.
describe("System health amounts (OPS-02)", () => {
  it("shows the database size in decimal megabytes, as the Supabase plan limit is written", () => {
    expect(formatMegabytes(123_456_789, "en")).toBe("123.5 MB");
    expect(formatMegabytes(400_000_000, "en")).toBe("400 MB");
    expect(formatMegabytes(400_000_000, "fa")).toBe("۴۰۰ MB");
  });

  it("shows a wait in minutes, then hours, then days", () => {
    expect(formatWait(0, "en")).toBe("0 mins");
    expect(formatWait(12 * 60_000 + 20_000, "en")).toBe("12 mins");
    expect(formatWait(59 * 60_000, "en")).toBe("59 mins");
    expect(formatWait(150 * 60_000, "en")).toBe("2.5 hrs");
    expect(formatWait(3 * 86_400_000, "en")).toBe("3 days");
    expect(formatWait(12 * 60_000, "fa")).toBe("۱۲ دقیقه");
  });
});
