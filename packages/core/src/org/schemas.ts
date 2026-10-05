import { z } from "zod";

const name = z.string().trim().min(1).max(160);
const title = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || null)
  .nullable();

/** Calendar dates retain the learner's chosen day, without converting through a time zone. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const classDate = z.string().refine(isCalendarDate, "invalid_calendar_date");
const uuid = z.uuid();

export const createCourseSchema = z.strictObject({ name });
export const renameCourseSchema = createCourseSchema;
export const createUnitSchema = z.strictObject({
  courseId: uuid,
  name,
  position: z.int().nonnegative().optional(),
});
export const updateUnitSchema = z
  .strictObject({ name: name.optional(), position: z.int().nonnegative().optional() })
  .refine((value) => Object.keys(value).length > 0, "empty_update");
export const createSessionSchema = z.strictObject({
  title: title.optional(),
  classDate: classDate.optional(),
  courseId: uuid.optional(),
  unitId: uuid.nullable().optional(),
});
export const updateSessionSchema = z
  .strictObject({
    title: title.optional(),
    classDate: classDate.optional(),
    courseId: uuid.optional(),
    unitId: uuid.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "empty_update");
export const sessionListSchema = z.strictObject({
  courseId: uuid.optional(),
  unitId: uuid.nullable().optional(),
  order: z.enum(["newest", "oldest"]).optional(),
  limit: z.int().min(1).max(100).optional(),
  offset: z.int().nonnegative().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type CreateSessionInput = z.input<typeof createSessionSchema>;
export type UpdateSessionInput = z.input<typeof updateSessionSchema>;
export type SessionListInput = z.infer<typeof sessionListSchema>;
