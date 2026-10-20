import Link from "next/link";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import { voiceSettingsReturnHref } from "../../../../ui/voice/navigation";
import { VoiceConfirmation } from "../../../../ui/voice/VoiceConfirmation";
import { VoiceProfileForm } from "../../../../ui/voice/VoiceProfile";
import "../../../../ui/workspace/workspace.css";

/** Test APIs are intercepted in Playwright. This guarded page never creates a real class. */
export default async function VoiceReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; blocked?: string; returnTo?: string | string[] }>;
}) {
  const { view, blocked, returnTo } = await searchParams;
  return (
    <div className="workspace-root">
      <AppShell
        current="me"
        hrefs={{
          today: "/dev/ui/voice",
          classes: "/dev/ui/voice?view=class",
          review: "/dev/ui/voice",
          me: "/dev/ui/voice",
        }}
      >
        <PageHeader
          title={view === "class" ? "Your voice in class" : "Your voice"}
          subtitle="Synthetic voice interface fixture · No real speaker identities"
        />
        <nav
          aria-label="Voice fixture views"
          style={{ display: "flex", gap: 20, marginBottom: 20 }}
        >
          <Link href="/dev/ui/voice">Voice settings</Link>
          <Link href="/dev/ui/voice?view=class">Session confirmation</Link>
        </nav>
        <div className="workspace-stack">
          {view === "class" ? (
            <VoiceConfirmation
              sessionId="10000000-0000-4000-8000-000000000001"
              userId="10000000-0000-4000-8000-000000000002"
            >
              <section aria-label="Synthetic session notes" className="workspace-panel">
                <h2>Session notes</h2>
                <p>Synthetic written notes remain independent of speaker confirmation.</p>
              </section>
            </VoiceConfirmation>
          ) : (
            <VoiceProfileForm
              captureBlocked={blocked === "1"}
              returnHref={voiceSettingsReturnHref(returnTo)}
            />
          )}
        </div>
      </AppShell>
    </div>
  );
}
