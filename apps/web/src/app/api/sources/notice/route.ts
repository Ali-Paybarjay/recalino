import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { sourceNoticeHandler } from "../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = defineRoute(ROUTES.sourceNotice, sourceNoticeHandler());
