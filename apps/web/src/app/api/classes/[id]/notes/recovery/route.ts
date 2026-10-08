import { defineRoute } from "../../../../../../server/api";
import { noteSourceRecoveryHandler } from "../../../../../../server/note-recovery-routes";
import { ROUTES } from "../../../../../../server/routes";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.noteSourceRecovery, noteSourceRecoveryHandler(id))(request);
}
