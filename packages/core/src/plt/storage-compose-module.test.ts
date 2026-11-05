import { Kysely, PostgresDialect, type PostgresPoolClient } from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { AppError, errors } from "./errors";
import { composeOwnedObjects, createObject, writeOwnedObject } from "./storage";
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
  const statements: string[] = [];
  let next = 0;
  const query = async (statement: string, parameters: readonly unknown[]) => {
    statements.push(statement);
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
  return { db, rows, statements };
}

type Seen = { rows?: Map<string, Row>; store?: MemoryObjectStore; statements?: string[] };

async function composeFor(module: string, seen?: Seen) {
  const { db, rows, statements } = database();
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
  if (seen) Object.assign(seen, { rows, store, statements });
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

  it("keeps the src key shape: module, owner and a random id, with no extension", async () => {
    const { target } = await composeFor("src");
    expect(target?.key).toMatch(
      new RegExp(`^src/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`),
    );
  });
});

/** Modules outside the allowlist /^[a-z][a-z0-9_-]*$/ (CWE-22 and look-alikes, P3-03). */
const REJECTED: [string, string][] = [
  ["empty", ""],
  ["a lone slash", "/"],
  ["a lone backslash", "\\"],
  ["dot-dot", ".."],
  ["a lone dot", "."],
  ["slash", "exp/x"],
  ["leading slash", "/src"],
  ["backslash", "exp\\x"],
  ["dot-dot inside", "src..exp"],
  ["traversal", "src/../exp"],
  ["a dot inside", "src.exp"],
  ["upper case", "SRC"],
  ["mixed case", "Src"],
  ["a newline", "src\n"],
  ["a NUL", "src\u0000"],
  ["a tab", "\tsrc"],
  ["a DEL", "src\u007f"],
  ["a space", "src x"],
  ["an encoded slash", "src%2Fexp"],
  ["an encoded lower-case slash", "src%2fexp"],
  ["an encoded dot-dot", "%2E%2E"],
  ["an encoded lower-case dot-dot", "%2e%2e"],
  ["a division slash", "src∕exp"],
  ["a fraction slash", "src⁄exp"],
  ["a fullwidth solidus", "src／exp"],
  ["a big solidus", "src⧸exp"],
  ["a fullwidth reverse solidus", "src＼exp"],
  ["a Cyrillic look-alike letter", "ѕrc"],
  ["a leading digit", "1src"],
  ["a leading hyphen", "-src"],
  ["a leading underscore", "_src"],
];

/** Modules every current caller passes; all must keep working unchanged (AC-4). */
const CALLER_MODULES = ["src", "exp", "priv", "media", "ops", "anki", "html", "voc", "proc"];

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectInvalidModule(failure: unknown, module: string): void {
  expect(failure).toBeInstanceOf(AppError);
  const appError = failure as AppError;
  expect(appError.code).toBe("validation_failed");
  expect(appError.details).toEqual({ fields: { storage: ["invalid_module"] } });
  // The fixed default message and fixed details: the value is never reflected.
  expect(appError.message).toBe(errors.validationFailed({}).message);
  if (module.length > 1) {
    expect(appError.message).not.toContain(module);
    expect(JSON.stringify(appError.details)).not.toContain(JSON.stringify(module).slice(1, -1));
  }
}

describe("composeOwnedObjects module sanitization (P2-01, P3-03)", () => {
  it.each(REJECTED)(
    "rejects a module with %s before any storage write or record",
    async (_, module) => {
      const seen: Seen = {};
      const failure = await failureOf(() => composeFor(module, seen));
      expectInvalidModule(failure, module);
      // Rejected before any load: no statement reached the database.
      expect(seen.statements).toEqual([]);
      // Only the two seeded parts: no destination record and no new object in the store.
      expect(seen.rows?.size).toBe(2);
      expect([...(seen.rows?.values() ?? [])].every((row) => row.key.includes("/part-"))).toBe(
        true,
      );
      const listed = await seen.store?.list("");
      expect(listed?.objects.map((object) => object.key)).toEqual([
        `src/${userId}/part-0`,
        `src/${userId}/part-1`,
      ]);
    },
  );
});

const now = new Date("2026-11-05T00:00:00Z");

function newObject(module: string, ownerUserId: string | null = userId) {
  return {
    module,
    ownerUserId,
    retention: "durable" as const,
    contentType,
    sizeBytes: 3,
    now,
  };
}

describe("createObject module allowlist (P3-03)", () => {
  it.each(REJECTED)("rejects a module with %s before any record", async (_, module) => {
    const { db, rows, statements } = database();
    try {
      const failure = await failureOf(() => createObject(db, newObject(module)));
      expectInvalidModule(failure, module);
      expect(statements).toEqual([]);
      expect(rows.size).toBe(0);
    } finally {
      await db.destroy();
    }
  });

  it.each(CALLER_MODULES)("records an object for the caller module %s", async (module) => {
    const { db, rows } = database();
    try {
      const { id, key } = await createObject(db, newObject(module));
      expect(key).toMatch(new RegExp(`^${module}/${userId}/${uuid}$`));
      expect(rows.get(id)).toMatchObject({ key, owner_module: module, state: "pending" });
    } finally {
      await db.destroy();
    }
  });

  it("keeps the src key shapes: src/<owner>/<uuid>, src/system/<uuid> and an extension", async () => {
    const { db } = database();
    try {
      expect((await createObject(db, newObject("src"))).key).toMatch(
        new RegExp(`^src/${userId}/${uuid}$`),
      );
      expect((await createObject(db, newObject("src", null))).key).toMatch(
        new RegExp(`^src/system/${uuid}$`),
      );
      expect((await createObject(db, { ...newObject("src"), extension: "apkg" })).key).toMatch(
        new RegExp(`^src/${userId}/${uuid}\\.apkg$`),
      );
    } finally {
      await db.destroy();
    }
  });
});

describe("writeOwnedObject module allowlist (P3-03)", () => {
  const bytes = new Uint8Array([7, 8, 9]);
  const writeInput = (module: string, targetObjectId?: string) => ({
    module,
    retention: "durable" as const,
    contentType,
    bytes,
    now,
    ...(targetObjectId ? { targetObjectId } : {}),
  });

  it.each(REJECTED)(
    "rejects a module with %s before any record or storage write",
    async (_, module) => {
      const { db, rows, statements } = database();
      const store = new MemoryObjectStore(() => now);
      let registered = false;
      try {
        const failure = await failureOf(() =>
          writeOwnedObject(
            db,
            store,
            { userId },
            {
              ...writeInput(module),
              onRegistered: async () => {
                registered = true;
              },
            },
          ),
        );
        expectInvalidModule(failure, module);
        expect(statements).toEqual([]);
        expect(rows.size).toBe(0);
        expect(registered).toBe(false);
        expect((await store.list("")).objects).toEqual([]);
      } finally {
        await db.destroy();
      }
    },
  );

  it.each(REJECTED)(
    "rejects a module with %s before loading a registered target",
    async (_, module) => {
      const { db, rows, statements } = database();
      const store = new MemoryObjectStore(() => now);
      const targetId = "22222222-0000-4000-8000-000000000001";
      rows.set(targetId, {
        id: targetId,
        key: `src/${userId}/target`,
        owner_module: "src",
        owner_user_id: userId,
        state: "pending",
        content_type: contentType,
        size_bytes: bytes.length,
      });
      try {
        const failure = await failureOf(() =>
          writeOwnedObject(db, store, { userId }, writeInput(module, targetId)),
        );
        expectInvalidModule(failure, module);
        expect(statements).toEqual([]);
        expect(rows.get(targetId)?.state).toBe("pending");
        expect((await store.list("")).objects).toEqual([]);
      } finally {
        await db.destroy();
      }
    },
  );

  it.each(CALLER_MODULES)(
    "writes and verifies an object for the caller module %s",
    async (module) => {
      const { db, rows } = database();
      const store = new MemoryObjectStore(() => now);
      try {
        const id = await writeOwnedObject(db, store, { userId }, writeInput(module));
        const row = rows.get(id);
        expect(row).toMatchObject({
          owner_module: module,
          owner_user_id: userId,
          state: "verified",
        });
        expect(row?.key).toMatch(new RegExp(`^${module}/${userId}/${uuid}$`));
        expect(await store.read(row?.key ?? "")).toEqual(bytes);
      } finally {
        await db.destroy();
      }
    },
  );

  it("keeps the src key shape for the system actor and an extension", async () => {
    const { db, rows } = database();
    const store = new MemoryObjectStore(() => now);
    try {
      const id = await writeOwnedObject(db, store, "system", {
        ...writeInput("src"),
        extension: "html",
      });
      expect(rows.get(id)?.key).toMatch(new RegExp(`^src/system/${uuid}\\.html$`));
    } finally {
      await db.destroy();
    }
  });

  it("writes into a registered src target unchanged", async () => {
    const { db, rows } = database();
    const store = new MemoryObjectStore(() => now);
    try {
      const { id: targetId, key } = await createObject(db, newObject("src"));
      const id = await writeOwnedObject(db, store, { userId }, writeInput("src", targetId));
      expect(id).toBe(targetId);
      expect(rows.get(id)).toMatchObject({ key, state: "verified" });
      expect(await store.read(key)).toEqual(bytes);
    } finally {
      await db.destroy();
    }
  });
});
