import { errors } from "./errors";

/** Who is acting. Every mutating domain function takes one (FR-PLT-002, PROJECT_SPEC §6). */
export interface LearnerContext {
  userId: string;
  requestId: string;
}

/**
 * FR-PLT-002. Load the resource by id without an owner filter, then call this before any side
 * effect. A missing resource and another user's resource get the same `not_found`; only the
 * second is marked for a security event, so existence never leaks.
 */
export function assertOwner<T extends { ownerId: string }>(
  resource: T | undefined,
  ctx: Pick<LearnerContext, "userId">,
): T {
  if (resource === undefined) throw errors.notFound();
  if (resource.ownerId !== ctx.userId) throw errors.ownershipDenied();
  return resource;
}
