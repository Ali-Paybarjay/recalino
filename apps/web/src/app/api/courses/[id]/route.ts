import { defineRoute } from "../../../../server/api";
import { courseHandler } from "../../../../server/org-routes";
import { ROUTES } from "../../../../server/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context) {
  return defineRoute(ROUTES.course, courseHandler((await context.params).id))(request);
}
export const GET = handle;
export const PATCH = handle;
export const DELETE = handle;
