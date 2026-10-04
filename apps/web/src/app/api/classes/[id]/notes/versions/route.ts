import { defineRoute } from "../../../../../../server/api";
import { ROUTES } from "../../../../../../server/routes";
import { noteVersionsHandler } from "../../../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.noteVersions, noteVersionsHandler(id))(request);
}
export const GET = handle;
