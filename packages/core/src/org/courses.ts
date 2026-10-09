import { type Selectable, sql } from "kysely";
import type { Database, DB, Tx } from "../db";
import { assertOwner, errors, type LearnerContext } from "../plt";
import {
  type CreateOptions,
  createOnce,
  iso,
  lockOrgAccount,
  nameError,
  requireReadyAccount,
} from "./common";
import {
  type CreateCourseInput,
  type CreateUnitInput,
  createCourseSchema,
  createUnitSchema,
  type UpdateUnitInput,
  updateUnitSchema,
} from "./schemas";

export interface Course {
  id: string;
  ownerId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Unit {
  id: string;
  ownerId: string;
  courseId: string;
  name: string;
  position: number;
  createdAt: string;
}

function course(row: Selectable<DB["org.course"]>): Course {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: iso(row.created_at),
  };
}

function unit(row: Selectable<DB["org.unit"]>): Unit {
  return {
    id: row.id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    name: row.name,
    position: row.position,
    createdAt: iso(row.created_at),
  };
}

export async function getCourse(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<Course> {
  const row = await db.selectFrom("org.course").selectAll().where("id", "=", id).executeTakeFirst();
  return assertOwner(row ? course(row) : undefined, ctx);
}

export async function listCourses(db: Database | Tx, ctx: LearnerContext): Promise<Course[]> {
  return (
    await db
      .selectFrom("org.course")
      .selectAll()
      .where("owner_id", "=", ctx.userId)
      .orderBy("is_default", "desc")
      .orderBy("name", "asc")
      .orderBy("id", "asc")
      .execute()
  ).map(course);
}

export async function createCourse(
  db: Database,
  ctx: LearnerContext,
  input: CreateCourseInput,
  options: CreateOptions,
): Promise<Course> {
  const parsed = createCourseSchema.parse(input);
  try {
    return await createOnce(db, ctx, "org.create_course", parsed, options, async (tx, now) => {
      await requireReadyAccount(tx, ctx);
      await uniqueCourseName(tx, ctx, parsed.name);
      const row = await tx
        .insertInto("org.course")
        .values({ owner_id: ctx.userId, name: parsed.name, created_at: now })
        .returningAll()
        .executeTakeFirstOrThrow();
      return course(row);
    });
  } catch (error) {
    return nameError(error);
  }
}

export async function renameCourse(
  db: Database,
  ctx: LearnerContext,
  id: string,
  input: CreateCourseInput,
): Promise<Course> {
  const parsed = createCourseSchema.parse(input);
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOrgAccount(tx, ctx);
      await getCourse(tx, ctx, id);
      await uniqueCourseName(tx, ctx, parsed.name, id);
      const row = await tx
        .updateTable("org.course")
        .set({ name: parsed.name })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return course(row);
    });
  } catch (error) {
    return nameError(error);
  }
}

export async function deleteCourse(db: Database, ctx: LearnerContext, id: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockOrgAccount(tx, ctx);
    const row = await tx
      .selectFrom("org.course")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return;
    const item = assertOwner(course(row), ctx);
    if (item.isDefault)
      throw errors.validationFailed({ courseId: ["default_course_cannot_be_deleted"] });
    const live = await tx
      .selectFrom("org.class_session")
      .select("id")
      .where("course_id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (live) throw errors.validationFailed({ courseId: ["move_or_delete_classes_first"] });
    // Keep the deletion tombstones and receipts even after their empty container is removed.
    await tx
      .updateTable("org.class_session")
      .set({ course_id: null, unit_id: null })
      .where("course_id", "=", id)
      .where("deleted_at", "is not", null)
      .execute();
    await tx.deleteFrom("org.course").where("id", "=", id).execute();
  });
}

/** Caller holds the account lock, so concurrent first classes share one default course. */
export async function defaultCourse(tx: Tx, ctx: LearnerContext, now: Date): Promise<Course> {
  const existing = await tx
    .selectFrom("org.course")
    .selectAll()
    .where("owner_id", "=", ctx.userId)
    .where("is_default", "=", true)
    .executeTakeFirst();
  if (existing) return course(existing);
  const named = await tx
    .selectFrom("org.course")
    .selectAll()
    .where("owner_id", "=", ctx.userId)
    .where(sql<boolean>`lower(name) = lower(${"My courses"})`)
    .executeTakeFirst();
  // A manually created "My courses" becomes the default rather than violating name uniqueness.
  if (named) {
    return course(
      await tx
        .updateTable("org.course")
        .set({ is_default: true })
        .where("id", "=", named.id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
  return course(
    await tx
      .insertInto("org.course")
      .values({ owner_id: ctx.userId, name: "My courses", is_default: true, created_at: now })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

async function uniqueCourseName(tx: Tx, ctx: LearnerContext, name: string, except?: string) {
  let query = tx
    .selectFrom("org.course")
    .select("id")
    .where("owner_id", "=", ctx.userId)
    .where(sql<boolean>`lower(name) = lower(${name})`);
  if (except) query = query.where("id", "!=", except);
  if (await query.executeTakeFirst()) throw errors.validationFailed({ name: ["already_exists"] });
}

export async function getUnit(db: Database | Tx, ctx: LearnerContext, id: string): Promise<Unit> {
  const row = await db.selectFrom("org.unit").selectAll().where("id", "=", id).executeTakeFirst();
  return assertOwner(row ? unit(row) : undefined, ctx);
}

export async function listUnits(
  db: Database | Tx,
  ctx: LearnerContext,
  courseId: string,
): Promise<Unit[]> {
  await getCourse(db, ctx, courseId);
  return (
    await db
      .selectFrom("org.unit")
      .selectAll()
      .where("course_id", "=", courseId)
      .where("owner_id", "=", ctx.userId)
      .orderBy("position", "asc")
      .orderBy("id", "asc")
      .execute()
  ).map(unit);
}

async function uniqueUnitName(tx: Tx, courseId: string, name: string, except?: string) {
  let query = tx
    .selectFrom("org.unit")
    .select("id")
    .where("course_id", "=", courseId)
    .where(sql<boolean>`lower(name) = lower(${name})`);
  if (except) query = query.where("id", "!=", except);
  if (await query.executeTakeFirst()) throw errors.validationFailed({ name: ["already_exists"] });
}

export async function createUnit(
  db: Database,
  ctx: LearnerContext,
  input: CreateUnitInput,
  options: CreateOptions,
): Promise<Unit> {
  const parsed = createUnitSchema.parse(input);
  try {
    return await createOnce(db, ctx, "org.create_unit", parsed, options, async (tx, now) => {
      await requireReadyAccount(tx, ctx);
      await getCourse(tx, ctx, parsed.courseId);
      await uniqueUnitName(tx, parsed.courseId, parsed.name);
      return unit(
        await tx
          .insertInto("org.unit")
          .values({
            owner_id: ctx.userId,
            course_id: parsed.courseId,
            name: parsed.name,
            position: parsed.position ?? 0,
            created_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    });
  } catch (error) {
    return nameError(error);
  }
}

export async function updateUnit(
  db: Database,
  ctx: LearnerContext,
  id: string,
  input: UpdateUnitInput,
): Promise<Unit> {
  const parsed = updateUnitSchema.parse(input);
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOrgAccount(tx, ctx);
      const existing = await getUnit(tx, ctx, id);
      if (parsed.name !== undefined) await uniqueUnitName(tx, existing.courseId, parsed.name, id);
      return unit(
        await tx
          .updateTable("org.unit")
          .set(parsed)
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    });
  } catch (error) {
    return nameError(error);
  }
}

export async function deleteUnit(db: Database, ctx: LearnerContext, id: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockOrgAccount(tx, ctx);
    const row = await tx.selectFrom("org.unit").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) return;
    assertOwner(unit(row), ctx);
    const live = await tx
      .selectFrom("org.class_session")
      .select("id")
      .where("unit_id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (live) throw errors.validationFailed({ unitId: ["move_or_delete_classes_first"] });
    await tx
      .updateTable("org.class_session")
      .set({ unit_id: null })
      .where("unit_id", "=", id)
      .execute();
    await tx.deleteFrom("org.unit").where("id", "=", id).execute();
  });
}
