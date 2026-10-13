import { readInputContract, sessionSources, sourceNoticeAccepted } from "@recalino/core/src";
import { requireLearner } from "../../../../../server/auth/learner";
import { readAutomaticLearning } from "../../../../../server/automatic-learning";
import { getDatabase } from "../../../../../server/db";
import { getObjectStore } from "../../../../../server/storage";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { AutomaticLearningView } from "../../../../../ui/workspace/AutomaticLearningView";
import { type SourceRow, SourcesView } from "../../../../../ui/workspace/SourcesView";
import { LearnerShell } from "../../../LearnerShell";

/**
 * One place for a session's material and its upload and processing status (FIVE_PROBLEMS §7.3
 * item 3). `/sources`, `/estimate` and `/processing` all show this page; the upload tray and
 * notifications lead here.
 */
export async function SessionMaterialPage({ id, path }: { id: string; path: string }) {
  const learner = await requireLearner(path),
    session = await workspaceSession(learner, id),
    db = getDatabase(),
    actor = workspaceActor(learner);
  const [contract, rows, automatic] = await Promise.all([
    readInputContract(db),
    sessionSources(db, actor, id),
    readAutomaticLearning(db, actor, id),
  ]);
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
      <div className="preview-stack">
        <AutomaticLearningView sessionId={id} initial={automatic} withMaterial />
        <SourcesView
          key={`${learner.userId}:${id}`}
          sessionId={id}
          userId={learner.userId}
          sources={sources}
          contract={contract}
          noticeAccepted={await sourceNoticeAccepted(db, actor, contract.noticeVersion)}
          storageConfigured={getObjectStore() !== null}
          withStatus
        />
      </div>
    </LearnerShell>
  );
}
