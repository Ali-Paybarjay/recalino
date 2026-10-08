import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";
import { reviewQueueHandler } from "../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return defineRoute(ROUTES.reviewQueue, reviewQueueHandler())(request);
}
export const GET = handle;
