import { defineRoute } from "../../../../../server/api";
import { classExportsHandler } from "../../../../../server/export-routes";
import { ROUTES } from "../../../../../server/routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classExports, classExportsHandler(id))(request);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.classExports, rateLimit: "export" },
    classExportsHandler(id),
  )(request);
}
