import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError, structuredTransportSchema } from "../aip";
import type { RunSource } from "./contracts";
import { buildKnowledgeInput } from "./knowledge-input";
import { buildKnowledgeRepairInput } from "./knowledge-repair";

function source(kind: RunSource["kind"] = "text"): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: randomUUID(),
    sha256: "a".repeat(64),
    kind,
    mimeType: "text/plain",
    role: "class_material",
    durationMs: null,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: [{ id: "unit", kind: "document", start: 1, status: "extracted" }],
    blocks: [
      { id: "block", unitId: "unit", kind: "paragraph", text: 'Full 😀 evidence "quoted"\nمتن.' },
    ],
  };
}
function input(sources: RunSource[], missingSourceIds: string[] = []) {
  return {
    sources,
    missingSourceIds,
    explanationLanguage: "fa",
    teachingPreferences: { shorterExamples: true },
  };
}
function output(key: string | null) {
  return {
    schemaVersion: "1",
    title: "Present perfect",
    language: { learning: "en", explanation: "fa" },
    summary: [
      {
        id: "claim",
        text: "این جمله کاربرد زمان حال کامل را توضیح می‌دهد.",
        evidenceKey: key,
        uncertain: false,
      },
    ],
    topics: [],
    learningItems: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
  };
}

describe("bounded knowledge repair evidence keys", () => {
  it("expands one exact native key, retains full text and derives machine-only audio attribution", () => {
    const audio = source("audio");
    audio.role = "class_audio";
    audio.durationMs = 10000;
    audio.units = [{ id: "unit", kind: "time", start: 1234, end: 5678, status: "extracted" }];
    audio.blocks[0] = {
      id: "block",
      unitId: "unit",
      kind: "transcript",
      text: "All original native words",
      speakerRole: "teacher",
      speakerId: "anonymous-1",
      timeStatus: "exact",
    };
    const before = JSON.stringify(audio);
    const repair = buildKnowledgeRepairInput(input([audio]), 120000);
    const encoded = JSON.parse(repair.input);
    expect(encoded.sources[0].evidence[0].slice(0, 5)).toEqual([
      "r0",
      "time",
      1234,
      5678,
      "All original native words",
    ]);
    const decoded = repair.decode(output("r0"));
    expect(decoded.summary[0]).toMatchObject({
      origin: "from_class",
      creation: "ai_generation",
      evidence: "audio",
      speakerRole: "unknown",
      sourceRefs: [
        {
          sourceId: audio.sourceId,
          contentVersionId: audio.contentVersionId,
          locator: { kind: "time", startMs: 1234, endMs: 5678 },
        },
      ],
    });
    expect(decoded.sourceClassifications).toEqual([
      {
        sourceId: audio.sourceId,
        classification: { role: "class_material", confidence: "uncertain" },
      },
    ]);
    expect(JSON.stringify(audio)).toBe(before);
    expect(buildKnowledgeRepairInput(input([audio]), 120000).input).toBe(repair.input);
  });

  it("preserves untimed full text with exact Unicode offsets and server-controlled incomplete coverage", () => {
    const audio = source("audio");
    audio.units[0] = {
      id: "unit",
      kind: "document",
      start: 1,
      status: "partial",
      reason: "timestamps_unavailable",
    };
    const repair = buildKnowledgeRepairInput(input([audio], [audio.sourceId]), 120000);
    const row = JSON.parse(repair.input).sources[0].evidence[0];
    expect(row.slice(0, 6)).toEqual([
      "r0",
      "text",
      "block",
      0,
      Array.from(audio.blocks[0]?.text ?? "").length,
      audio.blocks[0]?.text,
    ]);
    const decoded = repair.decode(output("r0"));
    expect(decoded.summary[0]?.sourceRefs[0]?.locator).toEqual({
      kind: "text",
      blockId: "block",
      start: 0,
      end: Array.from(audio.blocks[0]?.text ?? "").length,
    });
    expect(decoded.summary[0]?.speakerRole).toBe("unknown");
    expect(decoded.coverage).toEqual({ complete: false, missingSourceIds: [audio.sourceId] });
    expect(JSON.stringify(decoded.summary[0]?.sourceRefs)).not.toContain("startMs");
  });

  it("derives exact PDF and image evidence from authoritative roles without assigning authorship", () => {
    const pdf = source("pdf");
    pdf.pageCount = 7;
    pdf.units[0] = { id: "unit", kind: "page", start: 7, status: "extracted" };
    const board = source("image");
    board.role = "board_photo";
    const notes = source("image");
    notes.role = "user_notes";
    notes.captureAnchor = {
      sourceId: randomUUID(),
      offsetMs: 1234,
      state: "paused",
      timeStatus: "estimated",
    };
    const repair = buildKnowledgeRepairInput(input([pdf, board, notes]), 120000);
    const encoded = JSON.parse(repair.input);
    expect(encoded.sources[2].captureAnchor).toEqual(notes.captureAnchor);
    const raw = output("r0");
    raw.summary = ["r0", "r1", "r2"].map((key, index) => ({
      ...raw.summary[0],
      id: `claim-${index}`,
      text: "این شاهد به موضوع آموزشی مربوط است.",
      evidenceKey: key,
      uncertain: false,
    }));
    const decoded = repair.decode(raw);
    expect(decoded.summary.map((claim) => claim.evidence)).toEqual([
      "material",
      "board",
      "user_notes",
    ]);
    expect(decoded.summary[0]?.sourceRefs[0]?.locator).toEqual({
      kind: "page",
      page: 7,
      blockId: "block",
    });
    expect(decoded.summary[2]?.sourceRefs[0]?.locator.kind).toBe("text");
    expect(decoded.sourceClassifications.map((item) => item.classification.role)).toEqual([
      "class_material",
      "board_photo",
      "user_notes",
    ]);
    expect(
      decoded.summary.every(
        (claim) => claim.creation === "ai_generation" && claim.speakerRole === "unknown",
      ),
    ).toBe(true);
  });

  it("rejects invented/case-changed keys, translated language labels and model-created user confirmation", () => {
    const repair = buildKnowledgeRepairInput(input([source()]), 120000);
    expect(() => repair.decode(output("invented"))).toThrow();
    expect(() => repair.decode(output("R0"))).toThrow();
    const language = output("r0");
    language.language.explanation = "فارسی";
    expect(() => repair.decode(language)).toThrow();
    const creation = {
      ...output("r0"),
      summary: [{ ...output("r0").summary[0], creation: "user_confirmed" }],
    };
    expect(() => repair.decode(creation)).toThrow();
    const locator = {
      ...output("r0"),
      summary: [
        {
          ...output("r0").summary[0],
          sourceRefs: [{ locator: { kind: "time", startMs: 0, endMs: 999999 } }],
        },
      ],
    };
    expect(() => repair.decode(locator)).toThrow();
  });

  it("keeps genuine AI educational examples separate and refuses unsupported homework", () => {
    const repair = buildKnowledgeRepairInput(input([source()]), 120000);
    const decoded = repair.decode(output(null));
    expect(decoded.summary[0]).toMatchObject({
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    });
    const raw = output("r0");
    const unsupported = output(null).summary[0];
    if (!unsupported) throw new Error("Expected AI example fixture");
    const homework = { ...raw, homework: [unsupported] };
    expect(() => repair.decode(homework)).toThrow();
  });

  it("rejects each Latin-only Persian explanation even when another claim has Persian script", () => {
    const repair = buildKnowledgeRepairInput(input([source()]), 120000);
    const raw = output("r0");
    raw.summary.push({
      id: "english",
      text: "A Latin-only explanation.",
      evidenceKey: "r0",
      uncertain: false,
    });
    expect(() => repair.decode(raw)).toThrow();
    const backed = {
      ...output("r0"),
      learningItems: [
        {
          id: "item",
          kind: "expression",
          front: "Present perfect",
          back: "Only English",
          claim: output("r0").summary[0],
        },
      ],
    };
    expect(() => repair.decode(backed)).toThrow();
    expect(repair.system).toContain("Persian (Farsi)");
    expect(repair.system).toContain("Arabic script");
  });

  it("losslessly fits 1469 blocks from seven sources and shares one bounded enum in supported transport grammar", () => {
    const audio = source("audio");
    audio.role = "class_audio";
    audio.durationMs = 7200000;
    audio.units = Array.from({ length: 1400 }, (_, i) => ({
      id: `native-${i}`,
      kind: "time",
      start: i * 4000,
      end: (i + 1) * 4000,
      status: "extracted",
    }));
    audio.blocks = audio.units.map((unit, i) => ({
      id: `${unit.id}-text`,
      unitId: unit.id,
      kind: "transcript",
      text: `Segment ${String(i).padStart(4, "0")}: all full selected words.`,
      speakerRole: "unknown",
    }));
    const images = Array.from({ length: 6 }, (_, image) => {
      const selected = source("image");
      selected.blocks = Array.from({ length: image === 5 ? 9 : 12 }, (_, i) => ({
        id: `photo-${image}-${i}`,
        unitId: "unit",
        kind: "paragraph",
        text: `Full selected photo ${image} sentence ${i}.`,
      }));
      return selected;
    });
    const all = [audio, ...images];
    const before = JSON.stringify(all);
    const repair = buildKnowledgeRepairInput(input(all), 120000);
    const rows = JSON.parse(repair.input).sources.flatMap(
      (item: { evidence: unknown[][] }) => item.evidence,
    );
    expect(rows).toHaveLength(1469);
    expect(rows.map((row: unknown[]) => row[row[1] === "text" ? 5 : 4])).toEqual(
      all.flatMap((item) => item.blocks.map((block) => block.text)),
    );
    expect(new Set(rows.map((row: unknown[]) => row[0])).size).toBe(1469);
    expect(Array.from(repair.input).length).toBeLessThanOrEqual(120000);
    expect(JSON.stringify(all)).toBe(before);
    const transport = structuredTransportSchema(repair.schema, "anthropic/claude-haiku-4.5");
    const serialized = JSON.stringify(transport);
    expect(serialized).toContain('"$defs"');
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized.match(/"anyOf"/g)?.length ?? 0).toBeLessThan(16);
    expect(serialized.length).toBeLessThan(20000);
    expect(serialized.split('"r0"').length - 1).toBe(1);
  });

  it("fails before a request if complete selected text still exceeds the cap and leaves every word intact", () => {
    const selected = source();
    selected.blocks = [
      {
        id: "block",
        unitId: "unit",
        kind: "paragraph",
        text: "All selected words must remain. ".repeat(5000),
      },
    ];
    const before = JSON.stringify(selected);
    expect(() => buildKnowledgeRepairInput(input([selected]), 120000)).toThrow(ProviderError);
    expect(JSON.stringify(selected)).toBe(before);
  });

  it("checks the augmented keys against the same Unicode input cap after lossless compaction", () => {
    const audio = source("audio");
    audio.durationMs = 100000;
    audio.units = Array.from({ length: 120 }, (_, i) => ({
      id: `u${i}`,
      kind: "time",
      start: i * 500,
      end: (i + 1) * 500,
      status: "extracted",
    }));
    audio.blocks = audio.units.map((unit) => ({
      id: `${unit.id}-text`,
      unitId: unit.id,
      kind: "transcript",
      text: "Every selected 😀 word must survive in this full native evidence.",
      speakerRole: "unknown",
    }));
    const data = input([audio]);
    const base = buildKnowledgeInput(data, 20000);
    const baseBound = Array.from(base.input).length;
    expect(buildKnowledgeInput(data, baseBound).format).toBe("compact");
    const before = JSON.stringify(audio);
    expect(() => buildKnowledgeRepairInput(data, baseBound)).toThrow(ProviderError);
    expect(JSON.stringify(audio)).toBe(before);
  });

  it("preserves empty blocks as uncitable data while valid keys still select only nonempty evidence", () => {
    const selected = source();
    selected.blocks.unshift({ id: "empty", unitId: "unit", kind: "paragraph", text: "" });
    const repair = buildKnowledgeRepairInput(input([selected]), 120000);
    expect(JSON.parse(repair.input).sources[0].evidence[0][0]).toBeNull();
    expect(() => repair.decode(output("r0"))).toThrow();
    expect(repair.decode(output("r1")).summary[0]?.sourceRefs[0]?.locator).toMatchObject({
      kind: "text",
      blockId: "block",
      end: Array.from(selected.blocks[1]?.text ?? "").length,
    });
  });
});
