import { randomUUID } from "node:crypto";
import { allowance, DIMENSIONS, type Dimension } from "@recalino/core/quota";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { Actions, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";
const labels: Record<Dimension, string> = {
  audio: "Class audio",
  document: "Pages and images",
  regeneration: "New versions",
  tts: "Speech characters",
  storage: "File storage",
};
function units(dimension: Dimension, value: number): string {
  if (dimension === "audio") return `${Math.floor(value / 60)} min ${value % 60} sec`;
  if (dimension === "storage")
    return `${(value / 1048576).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MB`;
  return value.toLocaleString("en-GB");
}

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
          <p>
            No processing allowance is active. You can keep recording locally, read your notes and
            review your saved cards.
          </p>
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
        <LinkButton href="/classes">View classes</LinkButton>
        <LinkButton href="/me" secondary>
          Back to settings
        </LinkButton>
      </Actions>
    </LearnerShell>
  );
}
