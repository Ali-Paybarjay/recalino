import { defineRoute } from "../../../../server/api";
import { notificationPushHandler } from "../../../../server/notification-routes";
import { ROUTES } from "../../../../server/routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.notificationPush, notificationPushHandler());
export const POST = defineRoute(ROUTES.notificationPush, notificationPushHandler());
export const DELETE = defineRoute(ROUTES.notificationPush, notificationPushHandler());
