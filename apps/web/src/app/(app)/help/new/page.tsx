import { requireLearner } from "../../../../server/auth/learner";
import { createAuthClient } from "../../../../server/auth/supabase";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { SupportForm } from "../../../../ui/support/Support";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NewFeedbackPage() {
  const learner = await requireLearner("/help/new");
  const { data } = await (await createAuthClient()).auth.getUser();
  const email = data.user?.id === learner.userId ? (data.user.email ?? null) : null;
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader
          title="Send a message"
          subtitle="Ask a question or tell us what could work better."
        />
      }
    >
      <SupportForm userId={learner.userId} email={email} />
    </LearnerShell>
  );
}
