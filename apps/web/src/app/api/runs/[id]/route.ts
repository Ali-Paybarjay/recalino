import { defineRoute } from "../../../../server/api";
import { processingRunHandler } from "../../../../server/processing-routes";
import { ROUTES } from "../../../../server/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.processingRun, processingRunHandler(id))(request);
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.processingRun, processingRunHandler(id))(request);
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.processingRun, idempotency: "handler", rateLimit: "ai_start" },
    processingRunHandler(id),
  )(request);
}
export const maxDuration = 120;
