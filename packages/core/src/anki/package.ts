import { createHash } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import type { StudyCard } from "../card";
import { safeCardHtml } from "../lkm";
import { type ExportMediaBytes, errors, escapeExportHtml } from "../plt";

const runtimeTemporaryDirectory = tmpdir.bind(undefined);

export type AnkiCardSnapshot = Pick<
  StudyCard,
  | "id"
  | "template"
  | "direction"
  | "front"
  | "back"
  | "provenance"
  | "contentVersion"
  | "frontMediaId"
  | "backMediaId"
  | "contentFormat"
  | "studySet"
  | "studyTags"
>;
export interface AnkiPackageInput {
  sessionId: string;
  title: string;
  cards: AnkiCardSnapshot[];
  tags: string[];
  createdAt: string;
}
const BASIC = 1728123100001,
  CLOZE = 1728123100002;
const field = (name: string, ord: number) => ({
  name,
  ord,
  sticky: false,
  rtl: false,
  font: "Arial",
  size: 20,
  media: [],
});
const template = (cloze: boolean) => ({
  name: "Card",
  ord: 0,
  qfmt: cloze ? "{{cloze:Text}}" : "{{Front}}",
  afmt: cloze
    ? "{{cloze:Text}}<hr>{{Back}}<small>{{Provenance}}</small>"
    : "{{FrontSide}}<hr id=answer>{{Back}}<small>{{Provenance}}</small>",
  bqfmt: "",
  bafmt: "",
  did: null,
});
function model(id: number, cloze: boolean, did: number, mod: number) {
  return {
    id,
    name: cloze ? "Recalino Cloze v1" : "Recalino Basic v1",
    type: cloze ? 1 : 0,
    mod,
    usn: -1,
    sortf: 0,
    did,
    tmpls: [template(cloze)],
    flds: [field(cloze ? "Text" : "Front", 0), field("Back", 1), field("Provenance", 2)],
    css: '.card{font-family:system-ui,"Noto Sans",Tahoma,sans-serif;font-size:20px;line-height:1.7;text-align:center}.card :lang(en),.card [dir=ltr]:not([lang]){font-family:Lora,Georgia,"Noto Serif",serif}.card :is(:lang(fa),:lang(ar),:lang(ur),:lang(ps)),.card [dir=rtl]:not([lang]){font-family:Vazirmatn,"Noto Sans Arabic",Tahoma,sans-serif}.card :is(:lang(zh),:lang(ja),:lang(ko)){font-family:system-ui,"Noto Sans CJK SC","Noto Sans CJK TC","Noto Sans CJK JP","Noto Sans CJK KR",sans-serif}.ipa{font-family:"Noto Serif","Charis SIL","Gentium Plus","Times New Roman","DejaVu Serif",serif}hr{border:0;border-top:1px solid currentColor;opacity:.15;margin:1em 0}small{display:block;font-size:12px;opacity:.7;margin-top:18px}img{max-width:100%;height:auto}.cloze{font-weight:bold}',
    latexPre: "",
    latexPost: "",
    latexsvg: false,
    req: cloze ? [] : [[0, "any", [0]]],
  };
}
function stableInteger(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 13), 16);
}
export function ankiGuid(cardId: string): string {
  return createHash("sha256").update(`recalino-card-v1:${cardId}`).digest("base64url").slice(0, 20);
}
function safeField(value: string): string {
  return escapeExportHtml(value)
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("\n", "<br>");
}
export function clozeOrdinals(front: string): number[] {
  const pattern = /\{\{c([1-9][0-9]{0,2})::([^{}]+?)\}\}/g;
  const values = [...front.matchAll(pattern)].map((m) => Number(m[1]) - 1);
  if (!values.length || front.replace(pattern, "").includes("{{c"))
    throw errors.validationFailed({ cloze: ["invalid_syntax"] });
  return [...new Set(values)].sort((a, b) => a - b);
}
function mediaFilename(media: ExportMediaBytes): string {
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
  };
  const ext = extensions[media.media.mimeType];
  if (!ext) throw errors.unsupportedMedia();
  return `recalino_${media.media.id.replaceAll("-", "")}.${ext}`;
}
function provenance(card: AnkiCardSnapshot): string {
  const claim = card.provenance;
  const refs = claim.sourceRefs.map((r) =>
    r.locator.kind === "page"
      ? `page ${r.locator.page}`
      : r.locator.kind === "time"
        ? `${r.locator.startMs / 1000}–${r.locator.endMs / 1000}s`
        : `text ${r.locator.start}–${r.locator.end}`,
  );
  return safeField(
    [claim.origin, claim.creation, claim.evidence, claim.uncertain ? "uncertain" : "", ...refs]
      .filter(Boolean)
      .join(" · "),
  );
}
const SCHEMA = `
CREATE TABLE col(id INTEGER PRIMARY KEY,crt INTEGER NOT NULL,mod INTEGER NOT NULL,scm INTEGER NOT NULL,ver INTEGER NOT NULL,dty INTEGER NOT NULL,usn INTEGER NOT NULL,ls INTEGER NOT NULL,conf TEXT NOT NULL,models TEXT NOT NULL,decks TEXT NOT NULL,dconf TEXT NOT NULL,tags TEXT NOT NULL);
CREATE TABLE notes(id INTEGER PRIMARY KEY,guid TEXT NOT NULL,mid INTEGER NOT NULL,mod INTEGER NOT NULL,usn INTEGER NOT NULL,tags TEXT NOT NULL,flds TEXT NOT NULL,sfld INTEGER NOT NULL,csum INTEGER NOT NULL,flags INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE cards(id INTEGER PRIMARY KEY,nid INTEGER NOT NULL,did INTEGER NOT NULL,ord INTEGER NOT NULL,mod INTEGER NOT NULL,usn INTEGER NOT NULL,type INTEGER NOT NULL,queue INTEGER NOT NULL,due INTEGER NOT NULL,ivl INTEGER NOT NULL,factor INTEGER NOT NULL,reps INTEGER NOT NULL,lapses INTEGER NOT NULL,left INTEGER NOT NULL,odue INTEGER NOT NULL,odid INTEGER NOT NULL,flags INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE revlog(id INTEGER PRIMARY KEY,cid INTEGER NOT NULL,usn INTEGER NOT NULL,ease INTEGER NOT NULL,ivl INTEGER NOT NULL,lastIvl INTEGER NOT NULL,factor INTEGER NOT NULL,time INTEGER NOT NULL,type INTEGER NOT NULL);
CREATE TABLE graves(usn INTEGER NOT NULL,oid INTEGER NOT NULL,type INTEGER NOT NULL);
CREATE INDEX ix_notes_usn ON notes(usn);CREATE INDEX ix_cards_usn ON cards(usn);CREATE INDEX ix_revlog_usn ON revlog(usn);CREATE INDEX ix_cards_nid ON cards(nid);CREATE INDEX ix_cards_sched ON cards(did,queue,due);CREATE INDEX ix_revlog_cid ON revlog(cid);CREATE INDEX ix_notes_csum ON notes(csum);`;

/** Legacy schema-11 APKG: content-only new cards and stable GUIDs, no remote references. */
export async function buildAnkiPackage(
  input: AnkiPackageInput,
  media: readonly ExportMediaBytes[] = [],
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(runtimeTemporaryDirectory(), "recalino-anki-"));
  const path = join(directory, "collection.anki2");
  let sqlite: DatabaseSync | undefined;
  try {
    sqlite = new DatabaseSync(path);
    sqlite.exec("PRAGMA journal_mode=DELETE; PRAGMA page_size=4096;");
    sqlite.exec(SCHEMA);
    const mod = Math.floor(new Date(input.createdAt).getTime() / 1000);
    const did = stableInteger(`deck:${input.sessionId}`);
    const deck = {
      id: did,
      name: `Recalino::${input.title.replaceAll("::", " ").replaceAll("\n", " ").slice(0, 100)}`,
      mod,
      usn: -1,
      desc: "Content export. Review progress starts independently in Anki.",
      dyn: 0,
      collapsed: false,
      conf: 1,
      extendNew: 0,
      extendRev: 0,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    };
    const groupDecks = new Map(
      (["production", "recognition"] as const)
        .filter((set) => input.cards.some((card) => card.studySet === set))
        .map((set) => [
          set,
          {
            ...deck,
            id: stableInteger(`deck:${input.sessionId}:${set}`),
            name: `${deck.name}::${set === "production" ? "Core" : "Supplementary"}`,
          },
        ]),
    );
    const deckConf = {
      id: 1,
      name: "Default",
      mod: 0,
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      replayq: true,
      timer: 0,
      new: { delays: [1, 10], ints: [1, 4], initialFactor: 2500, order: 1, perDay: 20, bury: true },
      rev: {
        perDay: 200,
        ease4: 1.3,
        fuzz: 0.05,
        ivlFct: 1,
        maxIvl: 36500,
        bury: true,
        hardFactor: 1.2,
      },
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
    };
    const conf = {
      activeDecks: [did],
      curDeck: did,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      nextPos: input.cards.length + 1,
      sortType: "noteFld",
      sortBackwards: false,
      addToCur: true,
      curModel: BASIC,
    };
    sqlite.prepare("INSERT INTO col VALUES(1,?,?,?,?,0,-1,0,?,?,?,?,?)").run(
      mod,
      mod * 1000,
      mod * 1000,
      11,
      JSON.stringify(conf),
      JSON.stringify({
        [BASIC]: model(BASIC, false, did, mod),
        [CLOZE]: model(CLOZE, true, did, mod),
      }),
      JSON.stringify({
        [did]: deck,
        ...Object.fromEntries([...groupDecks.values()].map((group) => [group.id, group])),
      }),
      JSON.stringify({ 1: deckConf }),
      "{}",
    );
    const note = sqlite.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const cardInsert = sqlite.prepare(
      "INSERT INTO cards VALUES(?,?,?,?,?, -1,0,0,?,0,0,0,0,0,0,0,0,'')",
    );
    const names = new Map(media.map((m) => [m.media.id, mediaFilename(m)]));
    const seenIds = new Set<number>();
    let position = 0;
    for (const card of input.cards) {
      const id = stableInteger(`note:${card.id}`);
      if (seenIds.has(id)) throw errors.conflict();
      seenIds.add(id);
      const isCloze = card.template === "cloze";
      const ordinals = isCloze ? clozeOrdinals(card.front) : [0];
      const attach = (mediaId: string | null) => {
        if (!mediaId) return "";
        const name = names.get(mediaId);
        if (!name) throw errors.validationFailed({ media: ["missing_selected_media"] });
        const asset = media.find((m) => m.media.id === mediaId);
        return asset?.media.kind === "tts"
          ? `<br>[sound:${name}]`
          : `<br><img src="${name}" alt="Card material">`;
      };
      const face = (value: string) =>
        card.contentFormat === "lesson_html"
          ? safeCardHtml(value).replaceAll("[", "&#91;").replaceAll("]", "&#93;")
          : safeField(value);
      const front = face(card.front) + attach(card.frontMediaId);
      const back = face(card.back) + attach(card.backMediaId);
      const tags = [
        "Recalino",
        `Recalino::${card.template}`,
        card.provenance.origin,
        ...input.tags,
        ...(card.studyTags ?? []),
        ...(card.studySet ? [card.studySet] : []),
      ];
      const checksum = Number.parseInt(
        createHash("sha1").update(card.front).digest("hex").slice(0, 8),
        16,
      );
      note.run(
        id,
        ankiGuid(card.id),
        isCloze ? CLOZE : BASIC,
        mod,
        -1,
        ` ${[...new Set(tags)].join(" ")} `,
        [front, back, provenance(card)].join("\u001f"),
        card.front,
        checksum,
        0,
        "",
      );
      for (const ordinal of ordinals) {
        const cid = stableInteger(`card:${card.id}:${ordinal}`);
        if (seenIds.has(cid)) throw errors.conflict();
        seenIds.add(cid);
        cardInsert.run(
          cid,
          id,
          card.studySet ? (groupDecks.get(card.studySet)?.id ?? did) : did,
          ordinal,
          mod,
          ++position,
        );
      }
    }
    sqlite.close();
    sqlite = undefined;
    const files: Record<string, Uint8Array> = { "collection.anki2": await readFile(path) };
    const mediaMap: Record<string, string> = {};
    for (const [index, item] of media.entries()) {
      files[String(index)] = item.bytes;
      mediaMap[String(index)] = mediaFilename(item);
    }
    files.media = new TextEncoder().encode(JSON.stringify(mediaMap));
    // Stable timestamp means retries of the immutable snapshot produce the same package bytes.
    const mtime = new Date("2000-01-01T00:00:00Z");
    return zipSync(
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime }]])),
      { level: 6 },
    );
  } finally {
    sqlite?.close();
    await unlink(path).catch(() => undefined);
    await rmdir(directory);
  }
}
