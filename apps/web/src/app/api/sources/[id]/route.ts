import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { sourceHandler } from "../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.source, sourceHandler(id))(request);
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.source, sourceHandler(id))(request);
}
