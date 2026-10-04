import { defineRoute } from "../../../server/api";
import { coursesHandler } from "../../../server/org-routes";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.courses, coursesHandler());
export const POST = defineRoute({ ...ROUTES.courses, idempotency: "handler" }, coursesHandler());
