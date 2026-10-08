import { defineRoute } from "../../../../../server/api";
import { ROUTES } from "../../../../../server/routes";
import { notebookHandler } from "../../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    {
      ...ROUTES.noteNotebook,
      idempotency: ["POST"].includes(request.method) ? "handler" : undefined,
    },
    notebookHandler(id),
  )(request);
}
export const GET = handle;
export const POST = handle;
