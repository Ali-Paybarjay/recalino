import { defineRoute } from "../../../server/api";
import { ROUTES } from "../../../server/routes";
import { supportFeedbackHandler } from "../../../server/support-routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.supportFeedback, supportFeedbackHandler());
export const POST = defineRoute(ROUTES.supportFeedback, supportFeedbackHandler());
