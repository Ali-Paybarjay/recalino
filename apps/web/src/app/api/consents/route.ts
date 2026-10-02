import { consentsHandler } from "../../../server/account-routes";
import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";

export const POST = defineRoute(ROUTES.consents, consentsHandler());
