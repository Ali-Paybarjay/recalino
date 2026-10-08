import type { VoiceAcceptancePolicy } from "./policy";

/**
 * Evaluated acceptance policies, one per exact model revision. Numbers come only from a frozen
 * calibration split and are tested on a separate holdout (tools/voice/evaluation). A revision
 * without an entry never matches automatically and keeps every confirmed class as a reference.
 */
export const VOICE_ACCEPTANCE_POLICIES: readonly VoiceAcceptancePolicy[] = [];

export function voiceAcceptancePolicy(modelVersion: string): VoiceAcceptancePolicy | null {
  return VOICE_ACCEPTANCE_POLICIES.find((policy) => policy.modelVersion === modelVersion) ?? null;
}
