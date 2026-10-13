import { defineRoute } from "../../../../../server/api";
import { classCaptureHandler } from "../../../../../server/capture-staging";
import { ROUTES } from "../../../../../server/routes";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classCapture, classCaptureHandler(id))(request);
}
