import { z } from "zod";
import { AppError } from "./errors";

/**
 * Reads a JSONB snapshot column through its schema (audit QUA-05). A stored row that no longer
 * has the shape the code needs fails as a controlled `internal` error with the logged reason
 * `snapshot_invalid`, instead of being consumed with the wrong shape. Snapshot schemas are loose
 * objects, so keys they do not check pass through unchanged.
 */
export function parseSnapshot<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("internal", { reason: "snapshot_invalid" });
  return result.data;
}

/**
 * A nested object that its own, stricter schema validated when the snapshot was written (for
 * example a knowledge model or a claim). Only its container is checked on read, so a row written
 * under an earlier version of that schema is still accepted exactly as before.
 */
export function storedObject<T>() {
  return z.custom<T>(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  );
}
