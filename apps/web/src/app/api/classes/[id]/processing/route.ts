import { defineRoute } from "../../../../../server/api";
import { classProcessingHandler } from "../../../../../server/processing-routes";
import { ROUTES } from "../../../../../server/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classProcessing, classProcessingHandler(id))(request);
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.classProcessing, idempotency: "handler", rateLimit: "ai_start" },
    classProcessingHandler(id),
  )(request);
}
export const maxDuration = 120;
