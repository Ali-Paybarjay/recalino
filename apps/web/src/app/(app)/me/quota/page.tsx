import { randomUUID } from "node:crypto";
import { allowance, DIMENSIONS } from "@recalino/core/quota";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { allowanceLabels as labels, allowanceUnits as units } from "../../../../ui/allowance-units";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { Actions, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";

export default async function AllowancePage() {
  const learner = await requireLearner("/me/quota");
  const balance = await allowance(getDatabase(), {
    userId: learner.userId,
    requestId: randomUUID(),
  });
  const email = process.env.PILOT_OPERATOR_EMAIL;
  const contact =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? `mailto:${encodeURIComponent(email)}`
      : null;
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader
          title="Your allowance"
          subtitle="See what is available before you start processing."
        />
      }
    >
      <Panel title="Available now" tone="hero">
        {!balance.entitlementId ? (
          <>
            <p>
              Your current processing allowance is <strong>zero</strong>. You can keep recording
              locally, read your notes and review your saved cards.
            </p>
            <p>
              To receive pilot permission and an allowance, contact the pilot operator
              {email ? ` at ${email}` : " by email"}.
            </p>
          </>
        ) : (
          <p>
            Current period ends{" "}
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeZone: learner.state.timezone ?? "UTC",
            }).format(balance.endsAt ?? new Date())}
            .
          </p>
        )}
        <dl>
          {DIMENSIONS.map((d) => (
            <div key={d}>
              <dt>{labels[d]}</dt>
              <dd>{units(d, balance.remaining[d])}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Reserved and used">
        <p>
          Reserved allowance is held for work you confirmed. Only usable published output is
          charged.
        </p>
        <dl>
          {DIMENSIONS.map((d) => (
            <div key={d}>
              <dt>{labels[d]}</dt>
              <dd>
                {units(d, balance.reserved[d])} reserved · {units(d, balance.consumed[d])} used
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Need more allowance?">
        <p>
          The pilot operator sets your allowance. Processing starts only after you confirm its
          estimate.
        </p>
        {contact ? (
          <a href={contact} className="btn btn-secondary rc-btn-lg">
            Contact the pilot operator
          </a>
        ) : (
          <p>Operator contact details have not been configured yet.</p>
        )}
      </Panel>
      <Actions>
        <LinkButton href="/sessions">View courses</LinkButton>
        <LinkButton href="/me" secondary>
          Back to settings
        </LinkButton>
      </Actions>
    </LearnerShell>
  );
}
