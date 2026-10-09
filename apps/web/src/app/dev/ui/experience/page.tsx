import { StudyOverview } from "../../../../ui/components/StudyOverview";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";

/** The same first-use view as Today, available for UI review without a test account. */
export default function ExperiencePreview() {
  return (
    <AppShell
      current="today"
      hrefs={{ today: "/today", classes: "/sessions", review: "/review", me: "/me" }}
    >
      <PageHeader title="Today" kicker="Sunday 4 October" />
      <StudyOverview />
    </AppShell>
  );
}
