import { requireLearner } from "../../../../server/auth/learner";
import { AUTH_TIMED_OUT, authStep, createAuthClient } from "../../../../server/auth/supabase";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { SupportForm } from "../../../../ui/support/Support";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NewFeedbackPage() {
  const learner = await requireLearner("/help/new");
  // PERF-03: the email lookup is one more bounded Auth step; without an answer, no email is shown.
  const step = authStep();
  const result = await step.run((await createAuthClient(step.fetch)).auth.getUser());
  const user = result === AUTH_TIMED_OUT ? null : result.data.user;
  const email = user?.id === learner.userId ? (user.email ?? null) : null;
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
