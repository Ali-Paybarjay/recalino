import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { reviewSettingsHandler } from "../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return defineRoute(ROUTES.reviewSettings, reviewSettingsHandler())(request);
}
export const GET = handle;
export const PATCH = handle;
