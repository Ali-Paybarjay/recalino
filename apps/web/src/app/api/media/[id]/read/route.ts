import { defineRoute } from "../../../../../server/api";
import { mediaReadHandler } from "../../../../../server/media-routes";
import { ROUTES } from "../../../../../server/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.mediaRead, mediaReadHandler(id))(request);
}
