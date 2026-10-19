import { errors } from "../../plt";
import { type RunSource, sourceSnapshotSchema } from "../contracts";
import { extractAudioSource } from "./audio-source";
import { hasStoredOriginal, type ProcessingStage, YIELDED, type Yielded } from "./context";
import { extractImageSources } from "./image-sources";
import { extractPdfSource } from "./pdf-source";
import { cached, withinSelection } from "./runtime";

/**
 * The extraction stage (audit QUA-01, moved from processingJob): each source in snapshot order is
 * taken from its checkpoint, its saved content, or its own extraction stage; a stage that yields
 * ends this job. At least one source must have text.
 */
export const extractSources: ProcessingStage<void, RunSource[] | Yielded> = async (run) => {
  const { job, payload, snapshot } = run;
  const extracted: RunSource[] = [];
  for (const source of snapshot.sources) {
    const ready = await cached(
      job.db,
      payload.runId,
      `source:${source.sourceId}`,
      sourceSnapshotSchema.shape.sources.element,
    );
    if (ready) {
      extracted.push(withinSelection(ready));
      continue;
    }
    if (
      source.contentVersionId &&
      !(
        source.kind === "pdf" &&
        withinSelection(source).units.some((unit) => unit.reason === "ocr_required")
      )
    ) {
      extracted.push(withinSelection(source));
      continue;
    }
    if (!hasStoredOriginal(source))
      throw errors.validationFailed({ source: ["original_unavailable"] });
    if (source.kind === "audio") {
      const audio = await extractAudioSource(run, source);
      if (audio === YIELDED) return YIELDED;
      extracted.push(audio);
    } else if (source.kind === "pdf") {
      const pdf = await extractPdfSource(run, source);
      if (pdf === YIELDED) return YIELDED;
      extracted.push(pdf);
    } else if (source.kind === "image") {
      return extractImageSources(run, source);
    } else throw errors.validationFailed({ source: ["content_unavailable"] });
  }
  if (!extracted.some((source) => source.blocks.some((block) => block.text.trim())))
    throw errors.validationFailed({ sources: ["no_extractable_content"] });
  return extracted;
};
