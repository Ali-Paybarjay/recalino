import { readInputContract, sessionSources, sourceNoticeAccepted } from "@recalino/core/src";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { getObjectStore } from "../../../../../server/storage";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { type SourceRow, SourcesView } from "../../../../../ui/workspace/SourcesView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/sources`),
    session = await workspaceSession(learner, id),
    db = getDatabase(),
    actor = workspaceActor(learner);
  const contract = await readInputContract(db);
  const rows = await sessionSources(db, actor, id);
  const sources: SourceRow[] = rows.map((row) => ({
    ...row,
    ranges: row.ranges as { start: number; end: number }[],
    sizeBytes: Number(row.sizeBytes),
    durationMs: row.durationMs === null ? null : Number(row.durationMs),
    captureOffsetMs: row.captureOffsetMs === null ? null : Number(row.captureOffsetMs),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    originalDeletedAt: row.originalDeletedAt?.toISOString() ?? null,
  }));
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Session material" subtitle={session.displayTitle} />}
    >
      <SourcesView
        key={`${learner.userId}:${id}`}
        sessionId={id}
        userId={learner.userId}
        sources={sources}
        contract={contract}
        noticeAccepted={await sourceNoticeAccepted(db, actor, contract.noticeVersion)}
        storageConfigured={getObjectStore() !== null}
      />
    </LearnerShell>
  );
}
