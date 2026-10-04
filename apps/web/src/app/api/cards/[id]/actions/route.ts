import { defineRoute } from "../../../../../server/api";
import { ROUTES } from "../../../../../server/routes";
import { cardActionsHandler } from "../../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    {
      ...ROUTES.cardActions,
      idempotency: ["POST"].includes(request.method) ? "handler" : undefined,
    },
    cardActionsHandler(id),
  )(request);
}
export const POST = handle;
