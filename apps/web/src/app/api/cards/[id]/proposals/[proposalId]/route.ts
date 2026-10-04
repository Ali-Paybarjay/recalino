import { defineRoute } from "../../../../../../server/api";
import { ROUTES } from "../../../../../../server/routes";
import { cardProposalHandler } from "../../../../../../server/study-routes";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id, proposalId } = await context.params;
  return defineRoute(
    {
      ...ROUTES.cardProposal,
      idempotency: ["POST"].includes(request.method) ? "handler" : undefined,
    },
    cardProposalHandler(id, proposalId),
  )(request);
}
export const POST = handle;
