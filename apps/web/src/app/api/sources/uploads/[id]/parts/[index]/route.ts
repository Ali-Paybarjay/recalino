import { defineRoute } from "../../../../../../../server/api";
import { ROUTES } from "../../../../../../../server/routes";
import { sourcePartHandler } from "../../../../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index } = await context.params;
  return defineRoute(
    { ...ROUTES.sourcePart, rateLimit: "upload_url" },
    sourcePartHandler(id, index),
  )(request);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index } = await context.params;
  return defineRoute(
    { ...ROUTES.sourcePart, rateLimit: "upload_url" },
    sourcePartHandler(id, index),
  )(request);
}
