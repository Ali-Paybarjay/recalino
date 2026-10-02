import { defineRoute } from "../../../../server/api";
import { devSessionHandler } from "../../../../server/dev-auth";
import { ROUTES } from "../../../../server/routes";

export const dynamic = "force-dynamic";

export const POST = defineRoute(ROUTES.devAuthSession, devSessionHandler());
