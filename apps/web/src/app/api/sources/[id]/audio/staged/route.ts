import { defineRoute } from "../../../../../../server/api";
import { stagedAudioHandler } from "../../../../../../server/capture-staging";
import { ROUTES } from "../../../../../../server/routes";
export const dynamic = "force-dynamic";
// Completing a staged part may verify it in after().
export const maxDuration = 800;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const signedPart = new URL(request.url).searchParams.has("index");
  return defineRoute(
    { ...ROUTES.sourceStagedAudio, ...(signedPart ? { rateLimit: "upload_url" as const } : {}) },
    stagedAudioHandler(id),
  )(request);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.sourceStagedAudio, rateLimit: "upload_url" },
    stagedAudioHandler(id),
  )(request);
}
