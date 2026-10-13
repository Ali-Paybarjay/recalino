import { z } from "zod";
import { createLogger, type Logger } from "../plt";

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

/**
 * What an unreadable VOICE_SETTINGS_JSON falls back to: the D64 behaviours off, everything else
 * as shipped. The variable is the kill switch and may be edited in a hurry; a typo must never
 * stop a voice check or the class voice route (security review 2026-10-12, S3).
 */
export const VOICE_SETTINGS_FALLBACK: VoiceSettings = {
  ...DEFAULT_VOICE_SETTINGS,
  classConfirmation: false,
  targetTurns: false,
};

let reported: string | undefined;
/**
 * The deployment's switches. An invalid value is reported once per distinct value, as an event
 * without the value itself, and the safe fallback applies; nothing throws at request time.
 */
export function readVoiceSettings(
  env: Record<string, string | undefined> = process.env,
  log: Logger = createLogger(),
): VoiceSettings {
  const raw = env.VOICE_SETTINGS_JSON;
  if (!raw) return DEFAULT_VOICE_SETTINGS;
  const result = parseVoiceSettings(raw);
  if (result.ok) return result.settings;
  if (reported !== raw) {
    reported = raw;
    log("warn", "voice_settings_invalid", { module: "voc", reason: result.reason });
  }
  return VOICE_SETTINGS_FALLBACK;
}

function parseVoiceSettings(
  raw: string,
): { ok: true; settings: VoiceSettings } | { ok: false; reason: string } {
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_valid_json" };
  }
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    return { ok: false, reason: "not_an_object" };
  const result = voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, ...overrides });
  if (result.success) return { ok: true, settings: result.data };
  // Only setting names reach the log, never values.
  const name = result.error.issues[0]?.path.join(".") || "root";
  return { ok: false, reason: /^[A-Za-z0-9_.]{1,64}$/.test(name) ? name : "schema" };
}
