import { Kysely, PostgresDialect, type PostgresPoolClient } from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { composeOwnedObjects } from "./storage";
import { MemoryObjectStore } from "./storage-memory";

const userId = "5b8a3f2e-0c41-4d6e-9a17-2f3c4d5e6f70";
const contentType = "audio/mpeg";

type Row = {
  id: string;
  key: string;
  owner_module: string;
  owner_user_id: string | null;
  state: string;
  content_type: string;
  size_bytes: number;
};

/**
 * The real Kysely compiler runs against a synthetic query-only client: plt.storage_object
 * lives in a map, so the inserted row shows which module the destination was recorded for.
 */
function database() {
  const rows = new Map<string, Row>();
  let next = 0;
  const query = async (statement: string, parameters: readonly unknown[]) => {
    const result = (found: unknown[]) => ({
      command: "SELECT" as const,
      rowCount: found.length,
      rows: found,
    });
    if (statement.startsWith('insert into "plt"."storage_object"')) {
      const columns = [...(statement.match(/\(([^)]*)\) values/)?.[1] ?? "").matchAll(/"(\w+)"/g)];
      const values = Object.fromEntries(
        columns.map(([, name], index) => [name, parameters[index]]),
      );
      next += 1;
      const id = `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
      rows.set(id, {
        id,
        key: values.key as string,
        owner_module: values.owner_module as string,
        owner_user_id: (values.owner_user_id as string | null) ?? null,
        state: "pending",
        content_type: values.content_type as string,
        size_bytes: Number(values.size_bytes),
      });
      return result([{ id }]);
    }
    if (statement.startsWith('select "id", "key"') && statement.includes('"storage_object"')) {
      const row = rows.get(parameters[0] as string);
      return result(row ? [row] : []);
    }
    if (statement.startsWith('update "plt"."storage_object"')) {
      const id = parameters.find((value) => typeof value === "string" && rows.has(value));
      const row = typeof id === "string" ? rows.get(id) : undefined;
      if (row && parameters.includes("verified")) row.state = "verified";
      if (row && parameters.includes("deleted")) row.state = "deleted";
      return result([]);
    }
    throw new Error(`unexpected statement: ${statement}`);
  };
  const client = { query, release() {} } as unknown as PostgresPoolClient;
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: { options: {}, connect: async () => client, end: async () => {} },
    }),
  });
  return { db, rows };
}

async function composeFor(module: string) {
  const { db, rows } = database();
  const store = new MemoryObjectStore(() => new Date("2026-11-03T00:00:00Z"));
  const now = new Date("2026-11-03T00:00:00Z");
  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const partIds = parts.map((bytes, index) => {
    const id = `11111111-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const key = `src/${userId}/part-${index}`;
    rows.set(id, {
      id,
      key,
      owner_module: "src",
      owner_user_id: userId,
      state: "verified",
      content_type: contentType,
      size_bytes: bytes.length,
    });
    store.seed(key, bytes, contentType, now);
    return id;
  });
  try {
    const targetId = await composeOwnedObjects(
      db,
      store,
      { userId },
      { module, objectIds: partIds, contentType, sizeBytes: 5, now },
    );
    return { target: rows.get(targetId), store };
  } finally {
    await db.destroy();
  }
}

describe("composeOwnedObjects module (P1-07)", () => {
  it.each(["src", "exp"])(
    "records the destination for the module it is given: %s",
    async (module) => {
      const { target, store } = await composeFor(module);
      expect(target).toMatchObject({
        owner_module: module,
        owner_user_id: userId,
        state: "verified",
      });
      expect(target?.key.startsWith(`${module}/${userId}/`)).toBe(true);
      expect(await store.read(target?.key ?? "")).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    },
  );
});
