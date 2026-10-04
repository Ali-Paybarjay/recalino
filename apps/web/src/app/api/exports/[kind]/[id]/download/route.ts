import { defineRoute } from "../../../../../../server/api";
import { exportDownloadHandler } from "../../../../../../server/export-routes";
import { ROUTES } from "../../../../../../server/routes";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await context.params;
  return defineRoute(ROUTES.exportDownload, exportDownloadHandler(kind, id))(request);
}
