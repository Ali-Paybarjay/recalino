import type { AccountState } from "@recalino/core/acc";
import type { Metadata } from "next";
import { legalValues } from "../../../../server/legal";
import { LegalDocument } from "../../../../ui/components/LegalDocument";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import { strings } from "../../../../ui/strings";
import { ProfileSettings } from "../../../(app)/me/ProfileSettings";

export const metadata: Metadata = {
  title: "Settings design preview",
};

const previewState: Pick<AccountState, "profile" | "timezone"> = {
  profile: {
    version: 1,
    firstLanguage: "fa",
    learningLanguage: "en",
    explanationLanguage: "first_language",
    level: "B1",
    goal: "esol",
  },
  timezone: "Europe/London",
};

// The parent /dev layout gates this synthetic preview. No account or database access is needed.
export default function ProfilePreviewPage() {
  return (
    <AppShell
      current="me"
      hrefs={{
        today: "/dev/ui/experience",
        classes: "/sessions",
        review: "/review",
        me: "/dev/ui/profile",
      }}
    >
      <PageHeader kicker="Design preview · sample profile" title={strings.settings.title} />
      <ProfileSettings
        state={previewState}
        legal={{
          terms: <LegalDocument id="terms" values={legalValues()} />,
          privacy: <LegalDocument id="privacy" values={legalValues()} />,
        }}
      />
    </AppShell>
  );
}
