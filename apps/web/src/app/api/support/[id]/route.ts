import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { supportThreadHandler } from "../../../../server/support-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  return defineRoute(
    ROUTES.supportThread,
    supportThreadHandler((await context.params).id),
  )(request);
}
export const GET = handle;
export const POST = handle;
