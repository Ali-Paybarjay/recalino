import { defineRoute } from "../../../../server/api";
import { learningFeedbackHandler } from "../../../../server/pers-routes";
import { ROUTES } from "../../../../server/routes";
export const dynamic = "force-dynamic";
export const POST = defineRoute(ROUTES.learningFeedback, learningFeedbackHandler());
