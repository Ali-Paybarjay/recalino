import { z } from "zod";
import type { Database, Tx } from "../db";
import { errors, type LearnerContext } from "../plt";
import { getAccountState, lockAccount } from "./account";
export const teachingPreferenceKeys = ["shorter_examples"] as const;
const keySchema = z.enum(teachingPreferenceKeys);
export interface TeachingPreference {
  key: (typeof teachingPreferenceKeys)[number];
  origin: "explicit" | "inferred";
  value: unknown;
  updatedAt: string;
}
export async function listTeachingPreferences(
  db: Database | Tx,
  ctx: LearnerContext,
): Promise<TeachingPreference[]> {
  if (!(await getAccountState(db, ctx.userId))) throw errors.notFound();
  const rows = await db
    .selectFrom("acc.preference")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("key", "in", [...teachingPreferenceKeys])
    .execute();
  return rows.map((row) => ({
    key: keySchema.parse(row.key),
    origin: row.origin === "explicit" ? "explicit" : "inferred",
    value: row.value,
    updatedAt: row.updated_at.toISOString(),
  }));
}
export async function saveTeachingPreference(
  db: Database,
  ctx: LearnerContext,
  input: {
    key: TeachingPreference["key"];
    origin: TeachingPreference["origin"];
    value: boolean | { dismissed: boolean; evidenceCount: number };
  },
  now = new Date(),
): Promise<void> {
  keySchema.parse(input.key);
  if (!(await getAccountState(db, ctx.userId))) throw errors.notFound();
  const value =
    input.origin === "explicit"
      ? z.boolean().parse(input.value)
      : z
          .strictObject({ dismissed: z.boolean(), evidenceCount: z.int().nonnegative() })
          .parse(input.value);
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await tx
      .insertInto("acc.preference")
      .values({
        user_id: ctx.userId,
        key: input.key,
        origin: input.origin,
        value: JSON.stringify(value),
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(["user_id", "key", "origin"])
          .doUpdateSet({ value: JSON.stringify(value), updated_at: now }),
      )
      .execute();
  });
}
export async function resetInferredPreferences(db: Database, ctx: LearnerContext): Promise<void> {
  if (!(await getAccountState(db, ctx.userId))) throw errors.notFound();
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await tx
      .deleteFrom("acc.preference")
      .where("user_id", "=", ctx.userId)
      .where("origin", "=", "inferred")
      .execute();
  });
}
