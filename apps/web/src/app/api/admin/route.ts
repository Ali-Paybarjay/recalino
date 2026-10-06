import { adminHandler } from "../../../server/admin-routes";
import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
// An operator retry can start whole-source acoustic analysis in after().
export const maxDuration = 800;
export const GET = defineRoute(ROUTES.admin, adminHandler());
export const POST = defineRoute(ROUTES.admin, adminHandler());
