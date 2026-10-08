import { defineRoute } from "../../../../../server/api";
import { courseUnitsHandler } from "../../../../../server/org-routes";
import { ROUTES } from "../../../../../server/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context) {
  return defineRoute(
    { ...ROUTES.courseUnits, idempotency: request.method === "POST" ? "handler" : undefined },
    courseUnitsHandler((await context.params).id),
  )(request);
}
export const GET = handle;
export const POST = handle;
