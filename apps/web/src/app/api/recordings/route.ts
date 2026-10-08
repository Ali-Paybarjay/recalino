import { defineRoute } from "../../../server/api";
import { recordingSourceHandler } from "../../../server/recording-routes";
import { ROUTES } from "../../../server/routes";
export const POST = defineRoute(ROUTES.recordingSource, recordingSourceHandler());
