import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { sourceContractHandler } from "../../../../server/source-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = defineRoute(ROUTES.sourceContract, sourceContractHandler());
