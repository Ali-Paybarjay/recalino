import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";

/** Read live server-managed membership; user-editable Auth metadata never grants access. */
export async function isAdminOwner(db: Database | Tx, userId: string): Promise<boolean> {
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return false;
  const result = await sql<{ user_id: string }>`select user_id from plt.admin_owner
    where singleton = true and enabled = true and user_id = ${parsed.data}::uuid`.execute(db);
  return result.rows.length === 1;
}
