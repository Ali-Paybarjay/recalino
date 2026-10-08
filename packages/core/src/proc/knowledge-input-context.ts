import { z } from "zod";

/** Server-derived metadata that contributes to a paid knowledge request. */
export const knowledgeInputContextSchema = z.strictObject({
  version: z.literal(1),
  date: z.iso.date(),
  course: z.string().min(1).optional(),
});
