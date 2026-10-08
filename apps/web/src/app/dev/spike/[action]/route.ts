import { defineRoute } from "../../../../server/api";
import { ROUTES } from "../../../../server/routes";
import { spikeHandler } from "../../../../server/spike";

// SPIKE-05 only (M4): 404 unless RECALINO_SPIKE=1 and SPIKE_TOKEN match. Removed in T6.
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export const POST = defineRoute(ROUTES.spike, spikeHandler());
