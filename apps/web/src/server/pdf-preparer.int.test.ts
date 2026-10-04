import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { AiProvider, ProviderSettings } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import { MemoryObjectStore, readOwnedObject, writeOwnedObject } from "@recalino/core/plt";
import {
  cancelRun,
  cleanupSessionProcessing,
  createProcessingRun,
  processingJob,
  sourceSnapshotSchema,
} from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { selectSourceSnapshot } from "@recalino/core/src";
import ffmpeg from "ffmpeg-static";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { preparePdfPage } from "./pdf-preparer";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
function scannedPdf(mode: "jpeg" | "jpeg2000"): Buffer {
  const canvas = createCanvas(600, 180);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 600, 180);
  context.fillStyle = "black";
  context.font = "32px sans-serif";
  context.fillText("Synthetic scanned page", 20, 80);
  let image = canvas.toBuffer("image/jpeg", 85);
  let imageSize = "600 /Height 180";
  if (mode === "jpeg2000") {
    if (!ffmpeg) throw new Error("Synthetic JPEG2000 encoder unavailable");
    const encoded = spawnSync(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=16x16:d=0.04",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-c:v",
        "jpeg2000",
        "-format",
        "jp2",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 1048576 },
    );
    if (encoded.status !== 0 || !encoded.stdout.length)
      throw new Error("Synthetic JPEG2000 encoding failed");
    image = encoded.stdout;
    imageSize = "16 /Height 16";
  }
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"),
    ...[5, 6].map((id) =>
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 180] /Resources << /XObject << /Im0 7 0 R >> >> /Contents ${id} 0 R >>`,
      ),
    ),
    ...[1, 2].map(() => {
      const content = "q 600 0 0 180 0 0 cm /Im0 Do Q";
      return Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${imageSize} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${mode === "jpeg2000" ? "JPXDecode" : "DCTDecode"} /Length ${image.length} >>\nstream\n`,
      ),
      image,
      Buffer.from("\nendstream"),
    ]),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let length = parts[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const bytes = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(bytes);
    length += bytes.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
const settings: ProviderSettings = {
  version: "synthetic-render",
  llmModel: "synthetic",
  visionModel: "synthetic",
  sttModel: "synthetic",
  ttsModel: "synthetic",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const provider: AiProvider = {
  name: "synthetic-render",
  mode: "mock",
  settings,
  async structured() {
    throw new Error("No live provider used");
  },
  async transcribe() {
    throw new Error("No live provider used");
  },
  async speech() {
    throw new Error("No live provider used");
  },
};
it.each(["jpeg", "jpeg2000"] as const)(
  "renders only an owned selected scanned %s page and registers its bounded temporary image for cleanup",
  async (mode) => {
    const f = await studyFixture(db);
    const store = new MemoryObjectStore();
    const bytes = scannedPdf(mode);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await grantEntitlement(db, {
      userId: f.ctx.userId,
      startsAt: new Date(f.now.getTime() - 1000),
      endsAt: new Date(f.now.getTime() + 3600000),
      amounts: amounts({ document: 10, regeneration: 10 }),
      operationKey: randomUUID(),
      actorId: "synthetic-render-test",
      reason: "Synthetic scanned PDF renderer",
    });
    const objectId = await writeOwnedObject(db, store, f.ctx, {
      module: "src",
      retention: "durable",
      contentType: "application/pdf",
      bytes,
      now: f.now,
    });
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: f.ctx.userId,
        kind: "pdf",
        declared_mime: "application/pdf",
        verified_mime: "application/pdf",
        size_bytes: bytes.length,
        sha256,
        display_name: "Synthetic scanned.pdf",
        contract_version: "1",
        retention: "persistent",
        page_count: 2,
        original_object_id: objectId,
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        verified_at: f.now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("src.session_source")
      .values({
        user_id: f.ctx.userId,
        session_id: f.session.id,
        asset_id: asset.id,
        role: "class_material",
        selected: true,
        ranges: JSON.stringify([{ start: 2, end: 2 }]),
      })
      .execute();
    const snapshot = sourceSnapshotSchema.parse(
      await selectSourceSnapshot(db, f.ctx, f.session.id),
    );
    const source = snapshot.sources[0];
    if (!source) throw new Error("Expected selected source");
    const job = processingJob({ provider, store, preparePdfPage });
    const run = await createProcessingRun(
      db,
      f.ctx,
      { sessionId: f.session.id, operationKey: randomUUID() },
      { provider, job },
    );
    const input = { db, store, ctx: f.ctx, runId: run.id, source, page: 2, now: f.now };
    await expect(preparePdfPage({ ...input, page: 1 })).rejects.toMatchObject({
      code: "validation_failed",
    });
    const image = await preparePdfPage(input);
    expect(image.page).toBe(2);
    expect(image.mimeType).toBe("image/jpeg");
    const rendered = await readOwnedObject(db, store, f.ctx, image.objectId);
    expect(rendered.length).toBeGreaterThan(100);
    expect(rendered.length).toBeLessThan(5000000);
    if (mode === "jpeg2000") {
      const decoded = await loadImage(rendered);
      const sample = createCanvas(1, 1).getContext("2d");
      sample.drawImage(decoded, -decoded.width / 2, -decoded.height / 2);
      const [red, green, blue] = sample.getImageData(0, 0, 1, 1).data;
      expect(red).toBeGreaterThan(180);
      expect(green).toBeLessThan(80);
      expect(blue).toBeLessThan(80);
    }
    expect(
      await db
        .selectFrom("proc.temporary_object")
        .select("object_id")
        .where("run_id", "=", run.id)
        .execute(),
    ).toHaveLength(1);
    await cancelRun(db, f.ctx, run.id);
    await cleanupSessionProcessing(db, f.ctx, f.session.id, { store });
    await expect(readOwnedObject(db, store, f.ctx, image.objectId)).rejects.toMatchObject({
      code: "not_found",
    });
  },
);
