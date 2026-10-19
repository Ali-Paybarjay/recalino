import { defineRoute } from "../../../server/api";
import { healthHandler } from "../../../server/health";
import { ROUTES } from "../../../server/routes";

// Liveness: public, no database, no data. `?deep=1` with the cron token checks readiness.
export const dynamic = "force-dynamic";

export const GET = defineRoute(ROUTES.health, healthHandler());
