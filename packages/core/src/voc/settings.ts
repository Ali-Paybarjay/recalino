import { z } from "zod";

/**
 * Voice-detection switches (workstream 4, 2026-10-12). One confirmation per class and line-level
 * target-speaker choices are approved (owner decision 2026-10-12, D64) and on by default; each
 * has a kill switch. Wider background coverage stays off. Automatic acceptance is not a switch
 * here: it stays behind the D54 gates (`VOICE_ACCEPTANCE_POLICIES`). A deployment overrides any
 * value with VOICE_SETTINGS_JSON without a code change.
 */
export const voiceSettingsSchema = z.strictObject({
  /**
   * One confirmation per class across all linked recording parts (PRD-SPK-02, D64). Off (kill
   * switch): each part is confirmed on its own, as in FR-VOC-004 v2. Links are computed either way.
   */
  classConfirmation: z.boolean(),
  /**
   * Target-speaker turns (D64, FR-VOC v3): clean turns of at least `targetTurnMinMs` are scored
   * against the learner's own sample, likely lines are proposed, and the learner can mark lines
   * as theirs. Off (kill switch): no turn is embedded or scored and line choices are ignored.
   */
  targetTurns: z.boolean(),
  /** Shortest clean turn embedded for a target-speaker score. */
  targetTurnMinMs: z.int().min(1500).max(10000),
  /**
   * Lowest turn score proposed as a likely line of the learner. Not an evaluated acceptance
   * threshold (D54): a proposal only, which the learner confirms line by line.
   */
  targetTurnMinScore: z.number().min(-1).max(1),
  /**
   * Excerpt plan of background voice checks (an explicit "Check session voices" run); null keeps
   * VOICE_WINDOW_PLAN. The lesson's own check never uses it, so notes never wait for it.
   */
  backgroundCoverage: z
    .strictObject({
      windowMs: z.int().min(20000).max(120000),
      maxWindows: z.int().min(1).max(24),
    })
    .nullable(),
  /** Recording parts diarized at the same time within one job; the engine pool bounds CPU. */
  diarizationConcurrency: z.int().min(1).max(4),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  classConfirmation: true,
  targetTurns: true,
  targetTurnMinMs: 1500,
  targetTurnMinScore: 0.6,
  backgroundCoverage: null,
  // Parts are independent; the native pool still runs no more workers than the CPU allows.
  diarizationConcurrency: 3,
};

export function readVoiceSettings(
  env: Record<string, string | undefined> = process.env,
): VoiceSettings {
  const raw = env.VOICE_SETTINGS_JSON;
  if (!raw) return DEFAULT_VOICE_SETTINGS;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    throw new Error("Invalid VOICE_SETTINGS_JSON: not valid JSON");
  }
  const result = voiceSettingsSchema.safeParse({
    ...DEFAULT_VOICE_SETTINGS,
    ...(overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {}),
  });
  if (!result.success || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    const names = result.success
      ? ["root"]
      : [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid VOICE_SETTINGS_JSON: ${names.join(", ")}`);
  }
  return result.data;
}
