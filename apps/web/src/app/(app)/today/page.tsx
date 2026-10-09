import { listLearningSessions } from "@recalino/core/note";
import { getReviewQueue } from "@recalino/core/srs";
import { requireLearner } from "../../../server/auth/learner";
import { getDatabase } from "../../../server/db";
import { workspaceActor, workspaceGroups } from "../../../server/workspace";
import { Icon } from "../../../ui/components/Icon";
import { LearningLoop } from "../../../ui/components/StudyOverview";
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

/** Under Record on every Today state (frame B1 and copy.md, "Today — Record"). */
const RECORD_HELPER = "Starts right away · saved on this device · name it later";

export default async function TodayPage() {
  const learner = await requireLearner("/today");
  const [groups, sessions, review] = await Promise.all([
    workspaceGroups(learner),
    listLearningSessions(getDatabase(), workspaceActor(learner), { limit: 3 }),
    getReviewQueue(getDatabase(), workspaceActor(learner)),
  ]);
  const header = (
    <PageHeader kicker={todayLabel(learner.state.timezone)} title={strings.nav.today} />
  );
  // D32: Record a session is the only primary action on Today; everything else stays secondary.
  if (!sessions.items.length)
    return (
      <LearnerShell learner={learner} current="today" header={header}>
        {/* B1-empty, in D50 wording: one first step and its quiet alternative, then the routine. */}
        <div className="preview-stack">
          <Panel tone="hero" title="Your first session starts here.">
            <Icon icon={Microphone} size={40} />
            <p>Record your first session. We'll help you make notes and cards from it.</p>
            <Actions>
              <RecordLauncher />
              <LinkButton secondary href="/sessions/new">
                New session without recording
              </LinkButton>
            </Actions>
            <p className="preview-muted">{RECORD_HELPER}</p>
          </Panel>
          <LearningLoop />
        </div>
      </LearnerShell>
    );
  const record = (
    <Panel tone="hero" title="Your English, one class at a time.">
      <Icon icon={Microphone} size={40} />
      <p>Keep useful moments from your next English class.</p>
      <Actions>
        <RecordLauncher />
      </Actions>
      <p className="preview-muted">{RECORD_HELPER}</p>
    </Panel>
  );
  return (
    <LearnerShell learner={learner} current="today" header={header}>
      <div className="preview-stack">
        {/* B1-empty note: no review card until cards exist, so no "0 due" placeholder. */}
        {review.availableStudySets.length ? (
          <div className="preview-grid">
            {record}
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
        ) : (
          record
        )}
        <Panel title="Your recent sessions">
          <ClassRows sessions={sessions.items} {...groups} />
          <Actions>
            <LinkButton secondary href="/sessions">
              View all sessions
            </LinkButton>
            <LinkButton secondary href="/sessions/new">
              New session
            </LinkButton>
          </Actions>
        </Panel>
      </div>
    </LearnerShell>
  );
}
