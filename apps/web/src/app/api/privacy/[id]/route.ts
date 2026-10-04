import { defineRoute } from "../../../../server/api";
import { privacySessions } from "../../../../server/auth/learner";
import { privacyRequestHandler } from "../../../../server/privacy-routes";
import { ROUTES } from "../../../../server/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.privacyRequest, privacyRequestHandler(id), {
    sessions: privacySessions(),
  })(request);
}
