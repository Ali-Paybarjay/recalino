import { defineRoute } from "../../../server/api";
import { signOutHandler } from "../../../server/auth/flow";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";

export const POST = defineRoute(ROUTES.authSignOut, signOutHandler());
