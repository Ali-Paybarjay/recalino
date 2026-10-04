import { defineRoute } from "../../../../../server/api";
import { classMediaHandler } from "../../../../../server/media-routes";
import { ROUTES } from "../../../../../server/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classMedia, classMediaHandler(id))(request);
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.classMedia, idempotency: "handler", rateLimit: "ai_start" },
    classMediaHandler(id),
  )(request);
}
export const maxDuration = 120;
