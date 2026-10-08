import { defineRoute } from "../../../../../server/api";
import { ROUTES } from "../../../../../server/routes";
import { sourceAudioHandler } from "../../../../../server/source-routes";
export const dynamic = "force-dynamic";
// Upload completion may immediately start whole-source acoustic analysis in after().
export const maxDuration = 800;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const signedPart = new URL(request.url).searchParams.has("index");
  return defineRoute(
    { ...ROUTES.sourceAudio, ...(signedPart ? { rateLimit: "upload_url" as const } : {}) },
    sourceAudioHandler(id),
  )(request);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.sourceAudio, rateLimit: "upload_url" },
    sourceAudioHandler(id),
  )(request);
}
