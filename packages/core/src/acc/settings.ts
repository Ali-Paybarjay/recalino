import { z } from "zod";

export const accSettingsSchema = z.object({
  /**
   * Languages that passed the quality check (D31, rule 4; G05). Every other first language is
   * "experimental". Changing the list needs no code change.
   */
  verifiedLanguages: z.array(z.string().min(2).max(16)),
  /** How long the sign-in declarations wait for the return from Google (FR-ACC-001). */
  signupIntentTtlSeconds: z.number().int().min(60).max(3600),
});

export type AccSettings = z.infer<typeof accSettingsSchema>;

/** No language has passed the quality check yet: reviewers come after the MVP demo (PILOT_SETUP). */
export const DEFAULT_ACC_SETTINGS: AccSettings = {
  verifiedLanguages: [],
  signupIntentTtlSeconds: 10 * 60,
};

/** Reads ACC_SETTINGS_JSON over the defaults; an invalid value fails fast. */
export function readAccSettings(env: Readonly<Record<string, string | undefined>> = process.env) {
  const raw = env.ACC_SETTINGS_JSON;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ACC_SETTINGS;
  return accSettingsSchema.parse({ ...DEFAULT_ACC_SETTINGS, ...JSON.parse(raw) });
}
