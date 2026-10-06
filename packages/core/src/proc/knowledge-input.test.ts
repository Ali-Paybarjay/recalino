import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../aip";
import { type KnowledgeModel, validateKnowledgeModel } from "../lkm";
import type { RunSource } from "./contracts";
import { buildKnowledgeInput } from "./knowledge-input";
import { assertKnownSourceInputBound } from "./runs";

function source(kind: RunSource["kind"] = "text"): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: randomUUID(),
    sha256: "a".repeat(64),
    kind,
    mimeType: "text/plain",
    durationMs: null,
    pageCount: null,
    role: "class_material",
    ranges: [],
    captureAnchor: null,
    units: [{ id: "u", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "b", kind: "paragraph", text: 'Full 😀 متن "quoted"\ntext.', unitId: "u" }],
  };
}
function input(sources: RunSource[], missingSourceIds: string[] = []) {
  return {
    explanationLanguage: "en",
    teachingPreferences: { shorterExamples: true },
    sources,
    missingSourceIds,
  };
}

describe("knowledge input evidence transport", () => {
  it("keeps the original full format at and below the provider's Unicode character bound", () => {
    const original = source();
    const data = input([original]);
    const legacy = JSON.stringify({
      ...data,
      sources: data.sources.map(({ objectId: _objectId, sha256: _sha256, ...item }) => ({
        ...item,
        allowedSourceRefs: [
          {
            sourceId: item.sourceId,
            contentVersionId: item.contentVersionId,
            locator: {
              kind: "text",
              blockId: "b",
              start: 0,
              end: Array.from(item.blocks[0]?.text ?? "").length,
            },
          },
        ],
      })),
    });
    const result = buildKnowledgeInput(data, Array.from(legacy).length);
    expect(result).toMatchObject({ format: "full", input: legacy });
    expect(result.sourceRefPrompt).toContain("copy an allowedSourceRefs entry exactly");
    expect(JSON.parse(result.input).sources[0]).not.toHaveProperty("objectId");
    expect(legacy.length).toBeGreaterThan(Array.from(legacy).length);
  });

  it("losslessly fits a long native transcript by removing repeated transport identities", () => {
    const audio = source("audio");
    audio.role = "class_audio";
    audio.durationMs = 7200000;
    audio.units = Array.from({ length: 1700 }, (_, i) => ({
      id: `chunk-${i}-segment`,
      kind: "time",
      start: i * 4000,
      end: (i + 1) * 4000,
      status: "extracted",
    }));
    audio.blocks = audio.units.map((unit, i) => ({
      id: `${unit.id}-text`,
      kind: "transcript",
      text: `Segment ${String(i).padStart(4, "0")}: full selected sentence.`,
      unitId: unit.id,
      speakerRole: "unknown",
    }));
    const full = buildKnowledgeInput(input([audio]), 2000000);
    const compact = buildKnowledgeInput(input([audio]), 120000);
    const rows = JSON.parse(compact.input).sources[0].evidence;
    expect(Array.from(full.input).length).toBeGreaterThan(600000);
    expect(Array.from(compact.input).length).toBeLessThanOrEqual(120000);
    expect(compact.format).toBe("compact");
    expect(rows).toHaveLength(audio.blocks.length);
    for (const [i, block] of audio.blocks.entries())
      expect(rows[i]).toEqual(["time", audio.units[i]?.start, audio.units[i]?.end, block.text]);
    expect(compact.sourceRefPrompt).toContain("full output schema");
    expect(JSON.parse(compact.input).sources[0].blockDefaults).toEqual({
      kind: "transcript",
      speakerRole: "unknown",
    });
  });

  it("preserves exact page, native time, Unicode text refs, roles, capture context and uncertainty", () => {
    const audio = source("audio");
    audio.units = [
      { id: "u", kind: "time", start: 1234, end: 5678, status: "extracted" },
      {
        id: "fallback",
        kind: "document",
        start: 1,
        status: "partial",
        reason: "timestamps_unavailable",
      },
    ];
    audio.blocks[0] = {
      id: "b",
      kind: "transcript",
      text: "Confirmed teacher text",
      unitId: "u",
      speakerRole: "teacher",
      speakerId: "anonymous-2",
      timeStatus: "exact",
    };
    audio.blocks.push({
      id: "fallback-text",
      kind: "transcript",
      text: "Full untimed 😀 text.",
      unitId: "fallback",
    });
    const pdf = source("pdf");
    pdf.pageCount = 12;
    pdf.units[0] = { id: "u", kind: "page", start: 7, status: "extracted" };
    pdf.blocks[0] = {
      id: "pdf-heading",
      kind: "heading",
      level: 2,
      text: "Complete heading",
      unitId: "u",
    };
    const image = source("image");
    image.role = "user_notes";
    image.captureAnchor = {
      sourceId: audio.sourceId,
      offsetMs: 3333,
      state: "paused",
      timeStatus: "estimated",
    };
    const data = input([audio, pdf, image], [audio.sourceId]);
    const full = buildKnowledgeInput(data, 100000);
    const compact = buildKnowledgeInput(data, Array.from(full.input).length - 1);
    expect(compact.format).toBe("compact");
    const parsed = JSON.parse(compact.input);
    expect(parsed.missingSourceIds).toEqual([audio.sourceId]);
    expect(parsed.teachingPreferences).toEqual(data.teachingPreferences);
    expect(parsed.sources[0].evidence).toEqual([
      [
        "time",
        1234,
        5678,
        audio.blocks[0]?.text,
        { speakerRole: "teacher", speakerId: "anonymous-2", timeStatus: "exact" },
      ],
      [
        "text",
        "fallback-text",
        0,
        Array.from(audio.blocks[1]?.text ?? "").length,
        audio.blocks[1]?.text,
        { speakerRole: "unknown" },
      ],
    ]);
    expect(parsed.sources[0].incompleteUnits).toEqual([
      { kind: "document", start: 1, status: "partial", reason: "timestamps_unavailable" },
    ]);
    expect(parsed.sources[1].evidence).toEqual([["page", 7, "pdf-heading", "Complete heading"]]);
    expect(parsed.sources[1].blockDefaults).toMatchObject({ kind: "heading", level: 2 });
    expect(parsed.sources[2]).toMatchObject({
      role: "user_notes",
      captureAnchor: image.captureAnchor,
    });
    expect(parsed.sources[2].evidence[0]).toEqual([
      "text",
      "b",
      0,
      Array.from(image.blocks[0]?.text ?? "").length,
      image.blocks[0]?.text,
    ]);
    expect(compact.input).not.toContain("startMs");
    expect(compact.sourceRefPrompt).toContain("text row never proves teacher speech");
  });

  it("retains deterministic server rejection of changed locators and unconfirmed teacher attribution", () => {
    const audio = source("audio");
    audio.units = [{ id: "u", kind: "time", start: 100, end: 200, status: "extracted" }];
    audio.blocks[0] = {
      id: "b",
      kind: "transcript",
      text: "Full native text",
      unitId: "u",
      speakerRole: "unknown",
    };
    const full = buildKnowledgeInput(input([audio]), 100000);
    const parsed = JSON.parse(buildKnowledgeInput(input([audio]), full.input.length - 1).input);
    const [kind, startMs, endMs] = parsed.sources[0].evidence[0];
    const model: KnowledgeModel = {
      schemaVersion: "1",
      title: "Native evidence",
      language: { learning: "en", explanation: "en" },
      summary: [
        {
          id: "claim",
          text: "Full native text.",
          origin: "from_class",
          creation: "ai_generation",
          evidence: "audio",
          sourceRefs: [
            {
              sourceId: audio.sourceId,
              contentVersionId: audio.contentVersionId ?? "",
              locator: { kind, startMs, endMs },
            },
          ],
          speakerRole: "unknown",
          uncertain: false,
        },
      ],
      topics: [],
      learningItems: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    expect(validateKnowledgeModel(model, [audio], "en")).toEqual(model);
    const claim = model.summary[0];
    const ref = claim?.sourceRefs[0];
    if (!claim || !ref) throw new Error("Expected native claim fixture");
    claim.speakerRole = "teacher";
    expect(() => validateKnowledgeModel(model, [audio], "en")).toThrow();
    claim.speakerRole = "unknown";
    ref.locator = { kind: "time", startMs: 100, endMs: 201 };
    expect(() => validateKnowledgeModel(model, [audio], "en")).toThrow();
  });

  it("fails locally if every complete block still cannot fit, without truncating or mutating evidence", () => {
    const original = source();
    const block = original.blocks[0];
    if (!block) throw new Error("Expected full text fixture");
    block.text = "All selected words must survive. ".repeat(1000);
    const before = JSON.stringify(original);
    try {
      buildKnowledgeInput(input([original]), 1000);
      throw new Error("Expected bound failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({
        code: "provider_input_too_large",
        retryable: false,
        uncertain: false,
      });
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it("allows compactable cached transcripts before confirmation and excludes unselected material", () => {
    const audio = source("audio");
    audio.durationMs = 7200000;
    audio.ranges = [{ start: 0, end: 6800000 }];
    audio.units = Array.from({ length: 1700 }, (_, i) => ({
      id: `native-${i}`,
      kind: "time",
      start: i * 4000,
      end: (i + 1) * 4000,
      status: "extracted",
    }));
    audio.blocks = audio.units.map((unit, i) => ({
      id: `${unit.id}-text`,
      kind: "transcript",
      text: `Segment ${String(i).padStart(4, "0")}: full selected sentence.`,
      unitId: unit.id,
      speakerRole: "unknown",
    }));
    const snapshot = { sourcesVersion: 1, fingerprint: "synthetic", sources: [audio] };
    expect(buildKnowledgeInput(input([audio]), 2000000).input.length).toBeGreaterThan(120000);
    expect(() => assertKnownSourceInputBound(snapshot, 120000)).not.toThrow();
    audio.units.push({
      id: "unselected",
      kind: "time",
      start: 7000000,
      end: 7100000,
      status: "extracted",
    });
    audio.blocks.push({
      id: "unselected-text",
      kind: "transcript",
      text: "Unselected material. ".repeat(10000),
      unitId: "unselected",
    });
    const before = JSON.stringify(snapshot);
    expect(() => buildKnowledgeInput(input([audio]), 120000)).toThrow(ProviderError);
    expect(() => assertKnownSourceInputBound(snapshot, 120000)).not.toThrow();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("retains the preconfirmation validation error when complete selected content cannot fit", () => {
    const text = source();
    text.blocks = [
      { id: "b", kind: "paragraph", text: "All selected words. ".repeat(10000), unitId: "u" },
    ];
    try {
      assertKnownSourceInputBound(
        { sourcesVersion: 1, fingerprint: "synthetic", sources: [text] },
        120000,
      );
      throw new Error("Expected selected input bound failure");
    } catch (error) {
      expect(error).toMatchObject({
        code: "validation_failed",
        details: { fields: { sources: ["selected_text_too_large"] } },
      });
    }
  });
});
