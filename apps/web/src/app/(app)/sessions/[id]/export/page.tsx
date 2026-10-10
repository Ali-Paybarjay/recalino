import { listAnkiExports } from "@recalino/core/anki";
import { listCards } from "@recalino/core/card";
import { listHtmlExports } from "@recalino/core/html";
import { listMediaAssets } from "@recalino/core/media";
import { listNotebookRevisions } from "@recalino/core/note";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { exportSettings } from "../../../../../server/export-jobs";
import { getObjectStore } from "../../../../../server/storage";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { ExportView } from "../../../../../ui/workspace/ExportView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/export`);
  const session = await workspaceSession(learner, id);
  const db = getDatabase(),
    actor = workspaceActor(learner);
  const [revisions, cards, media, html, anki] = await Promise.all([
    listNotebookRevisions(db, actor, id),
    listCards(db, actor, { sessionId: id }),
    listMediaAssets(db, actor, id),
    listHtmlExports(db, actor, id),
    listAnkiExports(db, actor, id),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Take your learning with you" subtitle={session.displayTitle} />}
    >
      <ExportView
        sessionId={id}
        revisions={revisions.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.model.title,
          summary: r.model.summary.map((c) => ({ id: c.id, text: c.text })),
          practice: r.model.learningItems.map((i) => ({ id: i.id, front: i.front, back: i.back })),
        }))}
        cards={cards
          .filter((c) => !["deleted", "rejected"].includes(c.status))
          .map((c) => ({
            id: c.id,
            template: c.template,
            front: c.front,
            back: c.back,
            status: c.status,
            contentVersion: c.contentVersion,
            contentFormat: c.contentFormat,
            studySet: c.studySet,
            studyTags: c.studyTags,
            studyPosition: c.studyPosition,
          }))}
        images={media
          .filter((m) => m.kind === "image")
          .map((m) => ({ id: m.id, state: m.state, exportAllowed: m.exportAllowed }))}
        initial={{ html, anki }}
        settings={exportSettings()}
        storageConfigured={getObjectStore() !== null}
      />
    </LearnerShell>
  );
}
