import "server-only";
import { getCourse, getSession, listCourses, listUnits } from "@recalino/core/org";
import { AppError, errors, type LearnerContext } from "@recalino/core/plt";
import { notFound } from "next/navigation";
import type { Learner } from "./auth/learner";
import { getDatabase } from "./db";

export function workspaceActor(learner: Learner): LearnerContext {
  return { userId: learner.userId, requestId: "page-render" };
}
export function calendarDate(timezone: string | null, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export async function workspaceGroups(learner: Learner) {
  const db = getDatabase();
  const actor = workspaceActor(learner);
  const courses = await listCourses(db, actor);
  const units = (await Promise.all(courses.map((item) => listUnits(db, actor, item.id)))).flat();
  return { courses, units };
}
async function found<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "not_found") notFound();
    throw failure;
  }
}
function validId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw errors.notFound();
}
export function workspaceSession(learner: Learner, id: string) {
  return found(async () => {
    validId(id);
    return getSession(getDatabase(), workspaceActor(learner), id);
  });
}
export function workspaceCourse(learner: Learner, id: string) {
  return found(async () => {
    validId(id);
    return getCourse(getDatabase(), workspaceActor(learner), id);
  });
}
