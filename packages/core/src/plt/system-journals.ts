import { errors } from "./errors";
import type { ObjectStore } from "./storage";

/** Recovery may have lost Postgres metadata. Only generated private system journal keys qualify. */
export async function* readSystemJournalObjects(store: ObjectStore): AsyncGenerator<Uint8Array> {
  let cursor: string | undefined;
  let totalBytes = 0,
    records = 0;
  do {
    const page = await store.list("priv/system/", cursor);
    for (const item of page.objects) {
      if (
        !/^priv\/system\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          item.key,
        )
      )
        throw errors.validationFailed({ journal: ["unrecognized_private_object"] });
      records++;
      totalBytes += item.size;
      if (item.size > 1024 * 1024 || records > 100000 || totalBytes > 64 * 1024 * 1024)
        throw errors.payloadTooLarge();
      const bytes = await store.read(item.key);
      if (!bytes || bytes.length !== item.size) throw errors.conflict();
      yield bytes;
    }
    cursor = page.cursor;
  } while (cursor);
}
