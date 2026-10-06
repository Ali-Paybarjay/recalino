import type { RateLimitClass } from "@recalino/core/plt";

/** "system": only Vercel Cron and the app itself, with CRON_SECRET (FR-PLT-005). */
export type Access = "public" | "learner" | "admin" | "system";

export interface RouteMeta {
  id: string;
  /** URL path as Next.js serves it, e.g. "/api/health". */
  path: string;
  access: Access;
  /** FR-PLT-004: creating resources, using allowance and starting AI work require a key. */
  idempotency?: "required" | "handler";
  rateLimit?: RateLimitClass;
  /** Form posts and the sign-in flow: on any error, send the browser here instead of JSON. */
  errorRedirect?: string;
  /** A form can treat an already-ended session as its successful signed-out destination. */
  unauthenticatedRedirect?: string;
}

/**
 * Every API route is registered here. The coverage test fails for a route file that is not
 * registered and for a learner route without a cross-account test (FR-PLT-002, NFR-01).
 */
export const ROUTES = {
  admin: { id: "admin", path: "/api/admin", access: "admin" },
  supportFeedback: {
    id: "supportFeedback",
    path: "/api/support",
    access: "learner",
    rateLimit: "support",
  },
  supportThread: {
    id: "supportThread",
    path: "/api/support/[id]",
    access: "learner",
    rateLimit: "support",
  },
  health: { id: "health", path: "/api/health", access: "public" },
  // M3: sign-in (FR-ACC-001, FR-ACC-002). Form posts and redirects, so errors go to a page.
  authStart: {
    id: "authStart",
    path: "/auth/start",
    access: "public",
    rateLimit: "auth",
    errorRedirect: "/?error=signin",
  },
  authCallback: {
    id: "authCallback",
    path: "/auth/callback",
    access: "public",
    errorRedirect: "/?error=signin",
  },
  authSignOut: {
    id: "authSignOut",
    path: "/auth/sign-out",
    access: "learner",
    errorRedirect: "/me?error=signout",
    unauthenticatedRedirect: "/",
  },
  // M3: learning profile and acceptances (FR-ACC-003 to FR-ACC-007).
  profile: { id: "profile", path: "/api/profile", access: "learner" },
  voiceProfile: { id: "voiceProfile", path: "/api/me/voice", access: "learner" },
  classVoice: { id: "classVoice", path: "/api/classes/[id]/voice", access: "learner" },
  consents: { id: "consents", path: "/api/consents", access: "learner" },
  // ORG resource creation uses domain-owned atomic idempotency.
  courses: { id: "courses", path: "/api/courses", access: "learner" },
  course: { id: "course", path: "/api/courses/[id]", access: "learner" },
  courseUnits: { id: "courseUnits", path: "/api/courses/[id]/units", access: "learner" },
  unit: { id: "unit", path: "/api/units/[id]", access: "learner" },
  classes: { id: "classes", path: "/api/classes", access: "learner" },
  classSession: { id: "classSession", path: "/api/classes/[id]", access: "learner" },
  quota: { id: "quota", path: "/api/quota", access: "learner" },
  classMedia: { id: "classMedia", path: "/api/classes/[id]/media", access: "learner" },
  media: { id: "media", path: "/api/media/[id]", access: "learner" },
  mediaRead: { id: "mediaRead", path: "/api/media/[id]/read", access: "learner" },
  classExports: { id: "classExports", path: "/api/classes/[id]/exports", access: "learner" },
  exportArtifact: { id: "exportArtifact", path: "/api/exports/[kind]/[id]", access: "learner" },
  exportDownload: {
    id: "exportDownload",
    path: "/api/exports/[kind]/[id]/download",
    access: "learner",
  },
  privacyAccount: { id: "privacyAccount", path: "/api/privacy/account", access: "learner" },
  privacyRequest: { id: "privacyRequest", path: "/api/privacy/[id]", access: "learner" },
  sourceContract: { id: "sourceContract", path: "/api/sources/contract", access: "learner" },
  sourceNotice: { id: "sourceNotice", path: "/api/sources/notice", access: "learner" },
  sources: { id: "sources", path: "/api/sources", access: "learner" },
  source: { id: "source", path: "/api/sources/[id]", access: "learner" },
  sourceContent: { id: "sourceContent", path: "/api/sources/[id]/content", access: "learner" },
  sourceRead: { id: "sourceRead", path: "/api/sources/[id]/read", access: "learner" },
  sourceAudio: { id: "sourceAudio", path: "/api/sources/[id]/audio", access: "learner" },
  recordingSource: { id: "recordingSource", path: "/api/recordings", access: "learner" },
  sourceUnlock: { id: "sourceUnlock", path: "/api/sources/[id]/unlock", access: "learner" },
  classProcessing: {
    id: "classProcessing",
    path: "/api/classes/[id]/processing",
    access: "learner",
  },
  classLearning: {
    id: "classLearning",
    path: "/api/classes/[id]/learning",
    access: "learner",
  },
  processingEstimate: {
    id: "processingEstimate",
    path: "/api/classes/[id]/estimate",
    access: "learner",
  },
  processingRun: { id: "processingRun", path: "/api/runs/[id]", access: "learner" },
  noteNotebook: { id: "noteNotebook", path: "/api/classes/[id]/notes", access: "learner" },
  noteSourceRecovery: {
    id: "noteSourceRecovery",
    path: "/api/classes/[id]/notes/recovery",
    access: "learner",
    idempotency: "handler",
  },
  noteVersions: { id: "noteVersions", path: "/api/classes/[id]/notes/versions", access: "learner" },
  noteRevision: { id: "noteRevision", path: "/api/notes/[id]", access: "learner" },
  classCards: { id: "classCards", path: "/api/classes/[id]/cards", access: "learner" },
  card: { id: "card", path: "/api/cards/[id]", access: "learner" },
  cardActions: { id: "cardActions", path: "/api/cards/[id]/actions", access: "learner" },
  cardProposals: { id: "cardProposals", path: "/api/cards/[id]/proposals", access: "learner" },
  cardProposal: {
    id: "cardProposal",
    path: "/api/cards/[id]/proposals/[proposalId]",
    access: "learner",
  },
  cardMedia: { id: "cardMedia", path: "/api/cards/[id]/media", access: "learner" },
  reviewQueue: { id: "reviewQueue", path: "/api/review", access: "learner" },
  reviewEvent: { id: "reviewEvent", path: "/api/review/events", access: "learner" },
  reviewUndo: { id: "reviewUndo", path: "/api/review/events/[id]/undo", access: "learner" },
  reviewSettings: { id: "reviewSettings", path: "/api/review/settings", access: "learner" },
  learning: { id: "learning", path: "/api/learning", access: "learner" },
  learningPreferences: {
    id: "learningPreferences",
    path: "/api/learning/preferences",
    access: "learner",
  },
  classSources: { id: "classSources", path: "/api/classes/[id]/sources", access: "learner" },
  classSource: {
    id: "classSource",
    path: "/api/classes/[id]/sources/[sourceId]",
    access: "learner",
  },
  sourceUpload: { id: "sourceUpload", path: "/api/sources/uploads/[id]", access: "learner" },
  sourcePart: {
    id: "sourcePart",
    path: "/api/sources/uploads/[id]/parts/[index]",
    access: "learner",
  },
  sourceComplete: {
    id: "sourceComplete",
    path: "/api/sources/uploads/[id]/complete",
    access: "learner",
  },
  // M4: the job runner (FR-PLT-005, ADR-0003). Vercel Cron calls it every minute.
  jobsRun: { id: "jobsRun", path: "/api/jobs/run", access: "system" },
  // SPIKE-05 only (M4): 404 unless RECALINO_SPIKE=1 and SPIKE_TOKEN match. Removed in T6.
  spike: { id: "spike", path: "/dev/spike/[action]", access: "public" },
  // Local tests only: 404 unless the dev pages are on and Auth runs on this machine.
  devAuthSession: { id: "devAuthSession", path: "/dev/auth/session", access: "public" },
} as const satisfies Record<string, RouteMeta>;
