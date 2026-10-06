import { randomUUID } from "node:crypto";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { syntheticKnowledge } from "../../test/study-fixture";
import { renderStudyCard } from "../lkm";
import { type AnkiCardSnapshot, ankiGuid, buildAnkiPackage, clozeOrdinals } from "./package";

function card(template: AnkiCardSnapshot["template"] = "basic"): AnkiCardSnapshot {
  const provenance = syntheticKnowledge().summary[0];
  if (!provenance) throw new Error("Missing fixture claim");
  return {
    id: randomUUID(),
    template,
    direction: "forward",
    front: "سلام <script>alert(1)</script> [sound:evil.mp3]",
    back: "Unicode فارسی — answer",
    provenance,
    contentVersion: 1,
    frontMediaId: null,
    backMediaId: null,
  };
}
it("builds a schema-11 SQLite package with stable identifiers, passive Unicode fields and new review state", async () => {
  const basic = card(),
    cloze = { ...card("cloze"), front: "I {{c1::learn}} and {{c2::practice::verb}} English." };
  const input = {
    sessionId: randomUUID(),
    title: "Synthetic class",
    cards: [basic, cloze],
    tags: ["test::فارسی"],
    createdAt: "2026-10-04T00:00:00.000Z",
  };
  const bytes = await buildAnkiPackage(input);
  expect(await buildAnkiPackage(input)).toEqual(bytes);
  const files = unzipSync(bytes);
  const collection = files["collection.anki2"];
  if (!collection) throw new Error("Missing Anki collection");
  expect(Object.keys(files).sort()).toEqual(["collection.anki2", "media"]);
  expect(JSON.parse(new TextDecoder().decode(files.media))).toEqual({});
  const folder = await mkdtemp(join(tmpdir(), "recalino-anki-test-"));
  const path = join(folder, "collection.anki2");
  let sqlite: DatabaseSync | undefined;
  try {
    await writeFile(path, collection);
    sqlite = new DatabaseSync(path, { readOnly: true });
    expect(sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    const notes = sqlite.prepare("SELECT guid,flds,tags FROM notes ORDER BY id").all();
    expect(notes).toHaveLength(2);
    const note = notes.find((n) => n.guid === ankiGuid(basic.id));
    expect(note?.flds).toContain("سلام &lt;script&gt;");
    expect(note?.flds).toContain("&#91;sound:evil.mp3&#93;");
    expect(note?.tags).toContain("فارسی");
    expect(sqlite.prepare("SELECT count(*) AS count FROM cards").get()?.count).toBe(3);
    expect(sqlite.prepare("SELECT DISTINCT type,queue,ivl,reps,lapses FROM cards").all()).toEqual([
      { type: 0, queue: 0, ivl: 0, reps: 0, lapses: 0 },
    ]);
    expect(sqlite.prepare("SELECT count(*) AS count FROM revlog").get()?.count).toBe(0);
    const metadata = sqlite.prepare("SELECT ver,models FROM col").get();
    expect(metadata?.ver).toBe(11);
    expect(
      Object.values(JSON.parse(String(metadata?.models)))
        .map((m) => (m as { type: number }).type)
        .sort(),
    ).toEqual([0, 1]);
  } finally {
    sqlite?.close();
    await unlink(path);
    await rmdir(folder);
  }
});
it("includes only controlled local media names, with no external media links", async () => {
  const asset = {
    id: randomUUID(),
    sessionId: randomUUID(),
    sourceId: null,
    objectId: randomUUID(),
    kind: "tts" as const,
    mimeType: "audio/mpeg",
    byteLength: 3,
  };
  const listening = { ...card("listening"), frontMediaId: asset.id };
  const files = unzipSync(
    await buildAnkiPackage(
      {
        sessionId: asset.sessionId,
        title: "TTS",
        cards: [listening],
        tags: [],
        createdAt: "2026-10-04T00:00:00Z",
      },
      [{ media: asset, bytes: new Uint8Array([1, 2, 3]) }],
    ),
  );
  expect(files["0"]).toEqual(new Uint8Array([1, 2, 3]));
  expect(JSON.parse(new TextDecoder().decode(files.media))["0"]).toMatch(
    /^recalino_[a-f0-9]+\.mp3$/,
  );
});
it("rejects malformed cloze syntax instead of silently exporting broken cards", () => {
  expect(clozeOrdinals("{{c1::one}} and {{c1::two}} {{c3::three::hint}}")).toEqual([0, 2]);
  for (const value of [
    "No cloze",
    "{{c0::invalid}}",
    "{{c1::good}} {{c2::broken",
    "{{c1000::unsupported}}",
  ])
    expect(() => clozeOrdinals(value)).toThrow();
});

it("retains reference faces and group tags in APKG while neutralizing forged active HTML", async () => {
  const item = referenceStudyModel().learningItems[0];
  if (!item) throw new Error("Missing reference item");
  const rich = {
    ...card(),
    ...renderStudyCard(item),
    contentFormat: "lesson_html" as const,
    studySet: "production" as const,
    studyTags: ["2026-10-05", "cambria"],
  };
  const forged = { ...card(), contentFormat: "lesson_html" as const };
  const files = unzipSync(
    await buildAnkiPackage({
      sessionId: randomUUID(),
      title: "Reference",
      cards: [rich, forged],
      tags: [],
      createdAt: "2026-10-06T00:00:00Z",
    }),
  );
  const collection = files["collection.anki2"];
  if (!collection) throw new Error("Missing collection");
  const directory = await mkdtemp(join(tmpdir(), "recalino-rich-anki-"));
  const path = join(directory, "collection.anki2");
  let sqlite: DatabaseSync | undefined;
  try {
    await writeFile(path, collection);
    sqlite = new DatabaseSync(path, { readOnly: true });
    const notes = sqlite.prepare("SELECT guid, flds, tags FROM notes").all();
    const exported = notes.find((note) => note.guid === ankiGuid(rich.id));
    expect(String(exported?.flds).split("\u001f").slice(0, 2)).toEqual([rich.front, rich.back]);
    expect(exported?.tags).toContain("production");
    expect(exported?.tags).toContain("cambria");
    const untrusted = notes.find((note) => note.guid === ankiGuid(forged.id));
    expect(untrusted?.flds).not.toContain("<script>");
    expect(untrusted?.flds).not.toContain("[sound:evil.mp3]");
  } finally {
    sqlite?.close();
    await unlink(path);
    await rmdir(directory);
  }
});
