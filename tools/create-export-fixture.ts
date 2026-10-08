import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAnkiPackage } from "../packages/core/src/anki";
import { syntheticKnowledge } from "../packages/core/test/study-fixture";

const provenance = syntheticKnowledge().summary[0];
if (!provenance) throw new Error("missing synthetic claim");
const shared = {
  direction: "forward" as const,
  back: "Synthetic answer فارسی",
  provenance,
  contentVersion: 1,
  frontMediaId: null,
  backMediaId: null,
};
const bytes = await buildAnkiPackage({
  sessionId: "018dd184-6bb4-733a-b604-1b4f2b19311d",
  title: "Synthetic compatibility verification",
  createdAt: "2026-10-04T00:00:00Z",
  tags: ["synthetic::فارسی"],
  cards: [
    {
      ...shared,
      id: "018dd184-7ff4-7002-8518-80b10985d061",
      template: "basic",
      front: "Synthetic question <script>alert(1)</script>",
    },
    {
      ...shared,
      id: "018dd184-80a4-7a72-b4a9-732498a58b22",
      template: "cloze",
      front: "I {{c1::learn}} and {{c2::practice::verb}} English.",
    },
  ],
});
const folder = resolve("artifacts/verification");
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, "synthetic-export.apkg"), bytes);
process.stdout.write("Synthetic APKG fixture saved; no user data.\n");
