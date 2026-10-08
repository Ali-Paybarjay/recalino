import { defineRoute } from "../../../../../server/api";
import { ROUTES } from "../../../../../server/routes";
import { cardMediaHandler } from "../../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.cardMedia, idempotency: ["POST"].includes(request.method) ? "handler" : undefined },
    cardMediaHandler(id),
  )(request);
}
export const POST = handle;
