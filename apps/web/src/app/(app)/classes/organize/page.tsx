import Link from "next/link";
import { requireLearner } from "../../../../server/auth/learner";
import { workspaceGroups } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { CourseManager } from "../../../../ui/workspace/CourseManager";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";
export default async function OrganizePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const learner = await requireLearner("/classes/organize");
  const groups = await workspaceGroups(learner);
  const query = await searchParams;
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title="Keep your sessions organised"
          subtitle="Create courses and optional units, or rename and arrange them."
        />
      }
    >
      <div className="preview-stack">
        <Link className="preview-back" href="/classes">
          ← Back to courses
        </Link>
        <CourseManager {...groups} courseId={query.courseId} />
      </div>
    </LearnerShell>
  );
}
