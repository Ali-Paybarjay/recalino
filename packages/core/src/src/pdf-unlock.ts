import type { Database } from "../db";
import { errors, type LearnerContext, type ObjectStore, readOwnedObject } from "../plt";
import { readInputContract } from "./contracts";
import { appendContentVersion, getSource } from "./service";
import { extractPdfText } from "./verifier";

/** FR-SRC-005: password is request-local only; never a job payload, DB field or log. */
export async function unlockPdf(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  assetId: string,
  password: string,
  now = new Date(),
) {
  const source = await getSource(db, ctx, assetId);
  if (
    source.kind !== "pdf" ||
    !source.verified_at ||
    !source.original_object_id ||
    source.original_deleted_at
  )
    throw errors.notFound();
  const bytes = await readOwnedObject(db, store, ctx, source.original_object_id),
    contract = await readInputContract(db, source.contract_version);
  let extracted: Awaited<ReturnType<typeof extractPdfText>>;
  try {
    extracted = await extractPdfText(bytes, contract.formats.pdf.maxPages ?? 0, password);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      await db
        .updateTable("src.upload_session")
        .set({ rejection_reason: "wrong_password" })
        .where("asset_id", "=", assetId)
        .where("user_id", "=", ctx.userId)
        .execute();
      return { unlocked: false };
    }
    throw error;
  }
  await db.transaction().execute(async (tx) => {
    await getSource(tx, ctx, assetId);
    await tx
      .updateTable("src.asset")
      .set({ page_count: extracted.pageCount })
      .where("id", "=", assetId)
      .where("tombstoned_at", "is", null)
      .execute();
    await tx
      .updateTable("src.upload_session")
      .set({ rejection_reason: null })
      .where("asset_id", "=", assetId)
      .execute();
    await appendContentVersion(
      tx,
      ctx,
      assetId,
      {
        originKey: `pdf-unlocked:${source.sha256}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: { method: "pdf_text_layer", parser: "pdfjs-dist", parserVersion: "6.4.299" },
        units: extracted.units,
        blocks: extracted.blocks,
      },
      now,
    );
  });
  return { unlocked: true };
}
