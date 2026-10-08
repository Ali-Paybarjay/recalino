// FR-PLT-014 rule 2: an in-memory store for tests, so no test reaches a storage provider or spends
// credit. Its signed URLs carry the same limits a real store enforces: one key, one operation,
// one content type, a size ceiling and an expiry.
import { createHmac, randomBytes } from "node:crypto";
import type { ObjectStore, StoredObjectInfo } from "./storage";

type Stored = StoredObjectInfo & { bytes: Uint8Array };

export class MemoryObjectStore implements ObjectStore {
  readonly name = "memory";
  private readonly objects = new Map<string, Stored>();
  private readonly secret = randomBytes(32);

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private sign(fields: Record<string, string>): string {
    const query = new URLSearchParams(fields);
    query.sort();
    const signature = createHmac("sha256", this.secret).update(query.toString()).digest("hex");
    query.set("sig", signature);
    return `memory://store/?${query.toString()}`;
  }

  private verify(url: string, operation: string): URLSearchParams | null {
    const query = new URL(url).searchParams;
    const signature = query.get("sig");
    query.delete("sig");
    query.sort();
    const expected = createHmac("sha256", this.secret).update(query.toString()).digest("hex");
    if (signature !== expected || query.get("op") !== operation) return null;
    if (Number(query.get("until")) <= this.clock().getTime()) return null;
    return query;
  }

  async signWrite(
    key: string,
    limits: { contentType: string; maxBytes: number; validUntil: Date },
  ): Promise<string> {
    return this.sign({
      op: "put",
      key,
      type: limits.contentType,
      max: String(limits.maxBytes),
      until: String(limits.validUntil.getTime()),
    });
  }

  async signRead(key: string, validUntil: Date): Promise<string> {
    return this.sign({ op: "get", key, until: String(validUntil.getTime()) });
  }

  /** What the browser's PUT would get: 200, or 403 for a bad or expired link, 400 or 413. */
  upload(url: string, bytes: Uint8Array, contentType: string): number {
    const query = this.verify(url, "put");
    if (!query) return 403;
    if (contentType !== query.get("type")) return 400;
    if (bytes.byteLength > Number(query.get("max"))) return 413;
    const key = query.get("key") ?? "";
    this.objects.set(key, { bytes, size: bytes.byteLength, contentType, uploadedAt: this.clock() });
    return 200;
  }

  /** What a GET of a signed read URL would get. */
  download(url: string): { status: number; bytes?: Uint8Array } {
    const query = this.verify(url, "get");
    if (!query) return { status: 403 };
    const object = this.objects.get(query.get("key") ?? "");
    return object ? { status: 200, bytes: object.bytes } : { status: 404 };
  }

  /** Puts an object directly, as if it had been uploaded at `uploadedAt`. */
  seed(key: string, bytes: Uint8Array, contentType: string, uploadedAt: Date): void {
    this.objects.set(key, { bytes, size: bytes.byteLength, contentType, uploadedAt });
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const object = this.objects.get(key);
    return object
      ? { size: object.size, contentType: object.contentType, uploadedAt: object.uploadedAt }
      : null;
  }

  async read(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes ?? null;
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.seed(key, bytes, contentType, this.clock());
  }

  async compose(
    sourceKeys: readonly string[],
    targetKey: string,
    contentType: string,
  ): Promise<void> {
    const parts = sourceKeys.map((key) => this.objects.get(key));
    if (parts.some((part) => !part)) throw new Error("chunk missing");
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + (part?.size ?? 0), 0));
    let offset = 0;
    for (const part of parts) {
      if (!part) throw new Error("chunk missing");
      bytes.set(part.bytes, offset);
      offset += part.size;
    }
    this.seed(targetKey, bytes, contentType, this.clock());
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string, cursor?: string) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? keys.indexOf(cursor) + 1 : 0;
    const page = keys.slice(start, start + 100);
    const objects = page.map((key) => {
      const object = this.objects.get(key) as Stored;
      return { key, size: object.size, uploadedAt: object.uploadedAt };
    });
    const next = start + 100 < keys.length ? page.at(-1) : undefined;
    return next ? { objects, cursor: next } : { objects };
  }
}
