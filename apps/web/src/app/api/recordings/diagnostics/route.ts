import { defineRoute } from "../../../../server/api";
import { captureDiagnosticsHandler } from "../../../../server/recording-routes";
import { ROUTES } from "../../../../server/routes";
export const POST = defineRoute(ROUTES.captureDiagnostics, captureDiagnosticsHandler());
