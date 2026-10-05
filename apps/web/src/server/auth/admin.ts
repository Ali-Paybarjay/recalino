import "server-only";
import type { Database } from "@recalino/core/db";
import { errors, isAdminOwner } from "@recalino/core/plt";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "../db";
import type { SessionProvider } from "../session";
import { type AuthGateway, supabaseAuth } from "./gateway";

/** Membership is read on every request; user-editable claims never grant admin access. */
export async function isAdmin(db: Database, userId: string): Promise<boolean> {
  return isAdminOwner(db, userId);
}
export async function assertAdmin(db: Database, userId: string | null): Promise<void> {
  if (!userId) throw errors.unauthenticated();
  if (!(await isAdmin(db, userId))) throw errors.ownershipDenied();
}
export function adminSessions(auth: AuthGateway = supabaseAuth): SessionProvider {
  return {
    async getSession() {
      const user = await auth.currentUser();
      return user ? { userId: user.id } : null;
    },
  };
}
export async function requireAdmin(path: string): Promise<{ userId: string }> {
  const user = await supabaseAuth.currentUser();
  if (!user) redirect(`/?next=${encodeURIComponent(path)}`);
  if (!(await isAdmin(getDatabase(), user.id))) notFound();
  return { userId: user.id };
}
