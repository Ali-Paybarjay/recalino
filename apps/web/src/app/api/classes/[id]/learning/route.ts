import { defineRoute } from "../../../../../server/api";
import { automaticLearningHandler } from "../../../../../server/automatic-learning-routes";
import { ROUTES } from "../../../../../server/routes";

export const dynamic = "force-dynamic";
// Automatic learning can start whole-source acoustic analysis in after().
export const maxDuration = 800;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classLearning, automaticLearningHandler(id))(request);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classLearning, automaticLearningHandler(id))(request);
}
