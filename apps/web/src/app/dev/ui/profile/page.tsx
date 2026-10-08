import type { AccountState } from "@recalino/core/acc";
import type { Metadata } from "next";
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
        classes: "/classes",
        review: "/review",
        me: "/dev/ui/profile",
      }}
    >
      <PageHeader kicker="Design preview · sample profile" title={strings.settings.title} />
      <ProfileSettings state={previewState} />
    </AppShell>
  );
}
