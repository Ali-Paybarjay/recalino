import { defineRoute } from "../../../../server/api";
import { learningPreferencesHandler } from "../../../../server/pers-routes";
import { ROUTES } from "../../../../server/routes";
export const dynamic = "force-dynamic";
export const PATCH = defineRoute(ROUTES.learningPreferences, learningPreferencesHandler());
