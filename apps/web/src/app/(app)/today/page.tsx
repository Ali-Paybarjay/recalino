import { listLearningSessions } from "@recalino/core/note";
import { getReviewQueue } from "@recalino/core/srs";
import { requireLearner } from "../../../server/auth/learner";
import { getDatabase } from "../../../server/db";
import { workspaceActor, workspaceGroups } from "../../../server/workspace";
import { Icon } from "../../../ui/components/Icon";
import { Cards, Microphone } from "../../../ui/icons";
import { RecordLauncher } from "../../../ui/recording/RecordingProvider";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { ClassRows } from "../../../ui/workspace/ClassRows";
import { Actions, LinkButton, Panel } from "../../../ui/workspace/primitives";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** "Tuesday 30 September" in the learner's time zone (frame B1). */
function todayLabel(timezone: string | null): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone ?? "UTC",
  }).format(new Date());
}

export default async function TodayPage() {
  const learner = await requireLearner("/today");
  const [groups, sessions, review] = await Promise.all([
    workspaceGroups(learner),
    listLearningSessions(getDatabase(), workspaceActor(learner), { limit: 3 }),
    getReviewQueue(getDatabase(), workspaceActor(learner)),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="today"
      header={<PageHeader kicker={todayLabel(learner.state.timezone)} title={strings.nav.today} />}
    >
      <div className="preview-stack">
        <div className="preview-grid">
          <Panel tone="hero" title="Your English, one class at a time.">
            <Icon icon={Microphone} size={40} />
            <p>Keep useful moments from your next English class.</p>
            <Actions>
              <RecordLauncher />
              <LinkButton href="/classes/new">New session</LinkButton>
              <LinkButton secondary href="/classes">
                Add material to a session
              </LinkButton>
            </Actions>
          </Panel>
          <Panel title="Ready for a little practice?">
            <Icon icon={Cards} size={32} />
            <p>
              {review.dueCount} cards due · Up to {review.newRemaining} new today.
            </p>
            <Actions>
              <LinkButton secondary href="/review">
                Open review
              </LinkButton>
            </Actions>
            <p className="preview-muted">Your learning stays with your account.</p>
          </Panel>
        </div>
        <Panel title="Your recent sessions">
          {sessions.items.length ? (
            <ClassRows sessions={sessions.items} {...groups} />
          ) : (
            <div className="preview-empty">
              <h3>Your first session starts here.</h3>
              <p>Create a session and add a recording, handout, photo or notes.</p>
              <LinkButton href="/classes/new">Create a session</LinkButton>
            </div>
          )}
          <Actions>
            <LinkButton secondary href="/classes">
              View all sessions
            </LinkButton>
          </Actions>
        </Panel>
      </div>
    </LearnerShell>
  );
}
