import { defineRoute } from "../../../../../../server/api";
import { ROUTES } from "../../../../../../server/routes";
import { classSourceHandler } from "../../../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { id, sourceId } = await context.params;
  return defineRoute(ROUTES.classSource, classSourceHandler(id, sourceId))(request);
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { id, sourceId } = await context.params;
  return defineRoute(ROUTES.classSource, classSourceHandler(id, sourceId))(request);
}
