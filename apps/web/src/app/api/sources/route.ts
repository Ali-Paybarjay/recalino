import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";
import { sourcesHandler } from "../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = defineRoute(ROUTES.sources, sourcesHandler());
export const POST = defineRoute(ROUTES.sources, sourcesHandler());
