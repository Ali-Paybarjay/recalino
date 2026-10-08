import { defineRoute } from "../../../server/api";
import { notificationsHandler } from "../../../server/notification-routes";
import { ROUTES } from "../../../server/routes";
export const dynamic = "force-dynamic";
export const GET = defineRoute(ROUTES.notifications, notificationsHandler());
export const PATCH = defineRoute(ROUTES.notifications, notificationsHandler());
