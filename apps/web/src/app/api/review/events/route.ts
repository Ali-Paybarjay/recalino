import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { reviewEventHandler } from "../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return defineRoute(ROUTES.reviewEvent, reviewEventHandler())(request);
}
export const POST = handle;
