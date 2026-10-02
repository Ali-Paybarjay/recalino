import { defineRoute } from "../../../../server/api";
import { runJobsHandler } from "../../../../server/jobs";
import { ROUTES } from "../../../../server/routes";

export const dynamic = "force-dynamic";
// Must equal RUNNER_MAX_SECONDS in server/jobs.ts; Next.js needs a literal here.
export const maxDuration = 800;

export const GET = defineRoute(ROUTES.jobsRun, runJobsHandler());
