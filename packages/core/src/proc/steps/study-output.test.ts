import { describe, expect, it } from "vitest";
import { formatLogLine, type JobContext, type LogLevel } from "../../plt";
import { emptyStudyOutputAudit } from "../study-output-guard";
import { logStudyOutput } from "./study-output";

// D110 (owner decision 3): one counts-only log line, written through the real allow-list.
function captured() {
  const lines: Record<string, unknown>[] = [];
  const job = {
    job: { id: "job-1" },
    log: (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
      lines.push(JSON.parse(formatLogLine(level, event, fields)) as Record<string, unknown>);
    },
  } as unknown as JobContext;
  return { job, lines };
}

describe("logStudyOutput", () => {
  it("keeps every count through the log allow-list and writes no class text", () => {
    const { job, lines } = captured();
    logStudyOutput(job, {
      ...emptyStudyOutputAudit(18),
      gapsRebuilt: { spacing: 1, derivedBlank: 1 },
      droppedItems: { study_target_unsupported: 2, study_gap_missing: 1 },
      trimmedOverLimit: 1,
      unlinkedMistakes: 1,
      assemblyOmitted: { study_gap_partial: 1 },
    });
    expect(lines).toHaveLength(1);
    const { time: _time, ...line } = lines[0] ?? {};
    expect(line).toEqual({
      level: "info",
      event: "study_output_guard",
      module: "proc",
      job_id: "job-1",
      guard_version: "study-output-guard-1",
      production_limit: 18,
      gaps_spacing: 1,
      gaps_derived_blank: 1,
      dropped: 3,
      trimmed_over_limit: 1,
      unlinked_mistakes: 1,
      assembly_omitted: 1,
      code: "study_target_unsupported",
    });
    expect(line).not.toHaveProperty("dropped_fields");
  });
  it("writes nothing when the guard changed nothing", () => {
    const { job, lines } = captured();
    logStudyOutput(job, emptyStudyOutputAudit(18));
    expect(lines).toEqual([]);
  });
});
