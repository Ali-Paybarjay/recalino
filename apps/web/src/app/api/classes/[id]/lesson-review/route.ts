import { defineRoute } from "../../../../../server/api";
import { classLessonReviewHandler } from "../../../../../server/lesson-review-routes";
import { ROUTES } from "../../../../../server/routes";

export const dynamic = "force-dynamic";
// A requested review uses the same provider deadline and runner ceiling as class generation.
export const maxDuration = 800;

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(ROUTES.classLessonReview, classLessonReviewHandler(id))(request);
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return defineRoute(
    { ...ROUTES.classLessonReview, idempotency: "handler", rateLimit: "ai_start" },
    classLessonReviewHandler(id),
  )(request);
}
