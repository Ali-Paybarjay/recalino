import { requireLearner } from "../../../server/auth/learner";
import { legalValues } from "../../../server/legal";
import { accountCopy } from "../../../ui/account-copy";
import { Banner } from "../../../ui/components/Feedback";
import { LegalDocument } from "../../../ui/components/LegalDocument";
import { WarningCircle } from "../../../ui/icons";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { LearnerShell } from "../LearnerShell";
import { ProfileSettings } from "./ProfileSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const learner = await requireLearner("/me");
  const { error } = await searchParams;
  const values = legalValues();
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={<PageHeader title={strings.settings.title} />}
    >
      {error === "signout" ? (
        <Banner tone="danger" icon={WarningCircle} role="alert">
          {accountCopy.error.signOut}
        </Banner>
      ) : null}
      <ProfileSettings
        state={learner.state}
        legal={{
          terms: <LegalDocument id="terms" values={values} />,
          privacy: <LegalDocument id="privacy" values={values} />,
        }}
      />
    </LearnerShell>
  );
}
