import { adminHandler } from "../../../server/admin-routes";
import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = defineRoute(ROUTES.admin, adminHandler());
export const POST = defineRoute(ROUTES.admin, adminHandler());
