import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";

// A liveness check: public, no database, no data.
export const dynamic = "force-dynamic";

export const GET = defineRoute(ROUTES.health, async () => ({ body: { status: "ok" } }));
