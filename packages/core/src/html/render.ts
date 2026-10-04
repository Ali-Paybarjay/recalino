import type { Claim, KnowledgeModel, SourceRef } from "../lkm";
import { type ExportMediaBytes, escapeExportHtml as htmlEscape } from "../plt";

function locator(ref: SourceRef): string {
  if (ref.locator.kind === "time")
    return `${(ref.locator.startMs / 1000).toFixed(1)}–${(ref.locator.endMs / 1000).toFixed(1)} seconds`;
  if (ref.locator.kind === "page") return `page ${ref.locator.page}`;
  return `text ${ref.locator.start}–${ref.locator.end}`;
}
function claim(value: Claim): string {
  const labels = [
    value.origin === "from_class" ? "From class" : "AI expansion",
    value.creation.replaceAll("_", " "),
    value.evidence.replaceAll("_", " "),
  ];
  if (value.uncertain) labels.push("Uncertain");
  return `<article><p>${htmlEscape(value.text).replaceAll("\n", "<br>")}</p><small>${labels.map(htmlEscape).join(" · ")}${value.sourceRefs.length ? ` · ${value.sourceRefs.map((ref) => htmlEscape(locator(ref))).join("; ")}` : ""}</small></article>`;
}
/** Only structured notebook text is rendered. Input HTML never becomes markup. */
export function renderNotebookHtml(
  input: { revisionId: string; revisionNumber: number; model: KnowledgeModel; createdAt: string },
  media: readonly ExportMediaBytes[] = [],
): Uint8Array {
  const model = input.model;
  const rtl = ["fa", "ar", "ur", "ps"].includes(model.language.explanation.split("-")[0] ?? "");
  const sections = [
    model.summary.length
      ? `<section><h2>Summary</h2>${model.summary.map(claim).join("")}</section>`
      : "",
    ...model.topics.map(
      (topic) =>
        `<section><h2>${htmlEscape(topic.title)}</h2>${topic.claims.map(claim).join("")}</section>`,
    ),
    model.learningItems.length
      ? `<section><h2>Practice</h2>${model.learningItems.map((item) => `<details><summary dir="auto">${htmlEscape(item.front)}</summary><p dir="auto">${htmlEscape(item.back).replaceAll("\n", "<br>")}</p>${claim(item.claim)}</details>`).join("")}</section>`
      : "",
    model.homework.length
      ? `<section><h2>Homework</h2>${model.homework.map(claim).join("")}</section>`
      : "",
    model.uncertainties.length
      ? `<section><h2>Needs checking</h2>${model.uncertainties.map(claim).join("")}</section>`
      : "",
    media.length
      ? `<section><h2>Selected images</h2>${media.map(({ media: asset, bytes }) => `<figure><img alt="Selected class material" src="data:${htmlEscape(asset.mimeType)};base64,${Buffer.from(bytes).toString("base64")}"><figcaption>Exported with permission</figcaption></figure>`).join("")}</section>`
      : "",
  ].join("");
  const html = `<!doctype html><html lang="${htmlEscape(model.language.explanation)}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${htmlEscape(model.title)}</title><style>body{font:17px/1.7 system-ui,sans-serif;margin:0;background:#f6f3eb;color:#292923}main{max-width:780px;margin:auto;padding:36px 24px}h1,h2{line-height:1.3}section{margin-block:32px}article,details{border:1px solid #d5d1c5;border-radius:12px;padding:18px;margin-block:12px;background:white}small,footer{color:#55594f}summary{cursor:pointer;font-weight:600}img{max-width:100%;height:auto}figure{margin-inline:0}p{overflow-wrap:anywhere}@media print{body{background:white}details{break-inside:avoid}summary{list-style:none}}</style></head><body><main><header><p>Recalino · independent notebook copy</p><h1>${htmlEscape(model.title)}</h1><small>Revision ${input.revisionNumber} · ${htmlEscape(input.createdAt)} · ${htmlEscape(input.revisionId)}</small></header>${sections}<footer><p>This file contains the chosen notebook revision. Class audio, full transcripts, account information and review history are excluded. Downloaded copies remain independent of the account.</p><p>${model.coverage.complete ? "Source coverage complete" : "Source coverage incomplete: check the original notebook"}</p></footer></main></body></html>`;
  return new TextEncoder().encode(html);
}
