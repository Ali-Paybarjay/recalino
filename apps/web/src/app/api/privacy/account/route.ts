import { defineRoute } from "../../../../server/api";
import { privacySessions } from "../../../../server/auth/learner";
import { accountDeletionHandler } from "../../../../server/privacy-routes";
import { ROUTES } from "../../../../server/routes";
export const DELETE = defineRoute(
  { ...ROUTES.privacyAccount, idempotency: "handler" },
  accountDeletionHandler(),
  { sessions: privacySessions() },
);
export const maxDuration = 120;
