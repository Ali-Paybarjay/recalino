import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { voiceProfileHandler } from "../../../../server/voice-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const handle = defineRoute(ROUTES.voiceProfile, voiceProfileHandler());
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
