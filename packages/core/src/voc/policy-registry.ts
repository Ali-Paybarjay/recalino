import type { VoiceAcceptancePolicy } from "./policy";

/**
 * Evaluated acceptance policies, one per exact model revision. Numbers come only from a frozen
 * calibration split and are tested on a separate holdout (tools/voice/evaluation). A revision
 * without an entry keeps the account's own calibration (20 confirmed and 20 rejected classes)
 * and every confirmed class as a reference; an entry with `autoAccept: false` keeps every class
 * manual while still checking new references against the sample.
 */
export const VOICE_ACCEPTANCE_POLICIES: readonly VoiceAcceptancePolicy[] = [];

export function voiceAcceptancePolicy(modelVersion: string): VoiceAcceptancePolicy | null {
  return VOICE_ACCEPTANCE_POLICIES.find((policy) => policy.modelVersion === modelVersion) ?? null;
}
