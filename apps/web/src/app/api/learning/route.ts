import { defineRoute } from "../../../server/api";
import { learningHandler } from "../../../server/pers-routes";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.learning, learningHandler());
