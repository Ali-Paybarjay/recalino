import { profileHandler } from "../../../server/account-routes";
import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";

export const PATCH = defineRoute(ROUTES.profile, profileHandler());
