import type { LearningSession } from "@recalino/core/note";
import Link from "next/link";

export function SessionLearningSummary({
  session,
  showTopics = true,
}: {
  session: LearningSession;
  showTopics?: boolean;
}) {
  const topics = showTopics ? session.topics.slice(0, 3) : [];
  return (
    <div>
      <p className="workspace-muted">
        Session date: <time dateTime={session.classDate}>{session.classDate}</time>
        {" · "}
        {session.titleSource === "manual"
          ? "Custom title"
          : session.titleSource === "material"
            ? "Title from material"
            : "Title will update when material is ready"}
      </p>
      {topics.length ? (
        <p>
          <strong>Topics: </strong>
          {topics.map((topic, index) => (
            <span key={topic}>
              {index ? " · " : ""}
              <bdi>{topic}</bdi>
            </span>
          ))}
          {session.topics.length > topics.length ? (
            <>
              {" · "}
              <Link href={`/sessions/${session.id}#topics`}>
                See all {session.topics.length} topics
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
