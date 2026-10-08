import { defineRoute } from "../../../../../../server/api";
import { ROUTES } from "../../../../../../server/routes";
import { sourceCompleteHandler } from "../../../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.sourceComplete, sourceCompleteHandler(id))(request);
}
