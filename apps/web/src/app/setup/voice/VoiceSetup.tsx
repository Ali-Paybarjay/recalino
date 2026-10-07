"use client";

import { useRouter } from "next/navigation";
import { VoiceProfileForm } from "../../../ui/voice/VoiceProfile";
import { SetupFrame } from "../SetupFrame";
import styles from "../setup.module.css";

/** Core setup is already complete. Voice consent and a saved sample remain optional. */
export function VoiceSetup() {
  const router = useRouter();
  return (
    <SetupFrame index={5}>
      <div className={styles.voiceStep}>
        <h1 className={styles.title}>Your voice</h1>
        <p className={styles.help}>
          Optional · Save a short sample now, or do this later in Settings → Your voice.
        </p>
        <VoiceProfileForm onComplete={() => router.replace("/today")} />
      </div>
    </SetupFrame>
  );
}
