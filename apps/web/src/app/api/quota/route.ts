import { defineRoute } from "../../../server/api";
import { quotaHandler } from "../../../server/quota-routes";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.quota, quotaHandler());
