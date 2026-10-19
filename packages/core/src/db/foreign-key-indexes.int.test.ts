import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "./index";

// PERF-07 (audit 2026-10-18): each foreign key on a privacy-cleanup cascade path has an index whose
// leading columns are exactly the key's columns, the rule of the Supabase advisor
// `unindexed_foreign_keys` (migration 20261019120200).
const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

const HOT_FOREIGN_KEYS = [
  { table: "srs.review_event", columns: ["card_id", "user_id"] },
  { table: "srs.review_undo", columns: ["review_event_id", "user_id"] },
  { table: "card.revision", columns: ["card_id", "user_id"] },
  { table: "card.session_link", columns: ["session_id", "user_id"] },
  { table: "note.revision", columns: ["notebook_id", "user_id"] },
  { table: "card.proposal", columns: ["note_revision_id"] },
  { table: "org.class_session", columns: ["unit_id", "course_id", "owner_id"] },
];

it.each(HOT_FOREIGN_KEYS)(
  "indexes the foreign key $table($columns)",
  async ({ table, columns }) => {
    const { rows } = await sql<{ key: string[]; covered: boolean }>`
    select array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.n) as key,
      exists(select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
        and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)]
          = c.conkey) as covered
    from pg_constraint c
    where c.contype = 'f' and c.conrelid = ${table}::regclass`.execute(db);
    const key = rows.find((row) => row.key.join(",") === columns.join(","));
    expect(key).toEqual({ key: columns, covered: true });
  },
);
