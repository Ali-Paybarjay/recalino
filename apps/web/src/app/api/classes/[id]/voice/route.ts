import { defineRoute } from "../../../../../server/api";
import { ROUTES } from "../../../../../server/routes";
import { classVoiceHandler } from "../../../../../server/voice-routes";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classVoice, classVoiceHandler(id))(request);
}
export const GET = handle;
export const POST = handle;
