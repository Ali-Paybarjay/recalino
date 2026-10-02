import { defineRoute } from "../../../server/api";
import { callbackHandler } from "../../../server/auth/flow";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";

export const GET = defineRoute(ROUTES.authCallback, callbackHandler());
