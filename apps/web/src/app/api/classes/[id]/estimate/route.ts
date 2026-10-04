import { defineRoute } from "../../../../../server/api";
import { processingEstimateHandler } from "../../../../../server/processing-routes";
import { ROUTES } from "../../../../../server/routes";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.processingEstimate, processingEstimateHandler(id))(request);
}
