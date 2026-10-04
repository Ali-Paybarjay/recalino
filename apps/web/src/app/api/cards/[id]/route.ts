import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { cardHandler } from "../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.card, idempotency: ["PATCH"].includes(request.method) ? "handler" : undefined },
    cardHandler(id),
  )(request);
}
export const GET = handle;
export const PATCH = handle;
