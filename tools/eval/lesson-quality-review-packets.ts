import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";

/**
 * Copies the D62 blind A/B packets into a reviewer folder with each holdout lesson's required
 * concepts (its answer key for teaching, not the arm key). key.json is never copied.
 *
 *   pnpm exec tsx tools/eval/lesson-quality-review-packets.ts <eval-dir> <review-dir>
 */
const [evalDir, reviewDir] = process.argv.slice(2);
if (!evalDir || !reviewDir) throw new Error("usage: <eval-dir> <review-dir>");
const fixtures = new Map(holdout5MigrationFixtures().map((fixture) => [fixture.id, fixture]));
await mkdir(reviewDir, { recursive: true });
for (const file of await readdir(resolve(evalDir, "blind"))) {
  const packet = JSON.parse(await readFile(resolve(evalDir, "blind", file), "utf8"));
  const fixture = fixtures.get(String(packet.caseId).replace(/-repeat$/u, ""));
  const concepts = (
    (
      fixture?.expected as {
        concepts?: { id: string; criticalFacts: string[]; forbiddenErrors: string[] }[];
      }
    )?.concepts ?? []
  ).map(({ id, criticalFacts, forbiddenErrors }) => ({ id, criticalFacts, forbiddenErrors }));
  await writeFile(
    resolve(reviewDir, file),
    JSON.stringify({ ...packet, requiredConcepts: concepts }, null, 2),
  );
}
console.log("packets written");
