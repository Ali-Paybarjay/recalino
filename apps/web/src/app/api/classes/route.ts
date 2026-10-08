import { defineRoute } from "../../../server/api";
import { classesHandler } from "../../../server/org-routes";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.classes, classesHandler());
export const POST = defineRoute({ ...ROUTES.classes, idempotency: "handler" }, classesHandler());
