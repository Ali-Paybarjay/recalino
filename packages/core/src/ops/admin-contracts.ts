/** Browser-safe DTOs shared by the admin gateway and its user interface. */
export type AdminLocale = "en" | "fa";
export type LocalizedText = Record<AdminLocale, string>;
export type EmailPresentationSettings = {
  headline?: string;
  preheader?: string;
  action?: { label: string; url: string } | null;
};
/** Server-rendered, frozen output. UI never accepts or composes arbitrary HTML. */
export type EmailPresentationPreview = {
  previewHtml: string;
  text: string;
  designVersion: string;
  logoVersion: string;
  variant: string;
  headline: string;
  preheader: string;
  action?: { label: string; url: string } | null;
};
export type AdminView =
  | "overview"
  | "tasks"
  | "users"
  | "user"
  | "pilot"
  | "costs"
  | "rates"
  | "processing"
  | "feedback"
  | "thread"
  | "templates"
  | "history"
  | "privacy"
  | "backups"
  | "audit"
  | "settings";
export type Dimension = "audio" | "document" | "regeneration" | "tts" | "storage";
export type QuotaAmounts = Record<Dimension, number>;
export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  pilot: boolean;
  quotaActive: boolean;
  welcomeState: string;
};
export type AdminQuota = {
  entitlementId: string | null;
  allocated: QuotaAmounts;
  consumed: QuotaAmounts;
  reserved: QuotaAmounts;
  available: QuotaAmounts;
  startsAt: string | null;
  endsAt: string | null;
};
export type PilotSummary = {
  pilotId: string;
  version: string;
  capacity: number;
  admitted: number;
  active: number;
  defaults: QuotaAmounts;
  periodDays: number;
};
export type AdminCosts = {
  actualMicros: number;
  estimatedMicros: number;
  reservedMicros: number;
  unknownCount: number;
  currency: "USD";
  version: string;
  killSwitch: boolean;
  limits: { session: number; userMonth: number; systemDay: number; systemMonth: number };
};
export type AdminTask = {
  id: string;
  kind: string;
  title: string | LocalizedText;
  detail?: string | LocalizedText;
  userIds: string[];
  threadId?: string;
  runId?: string;
  state: string;
  createdAt: string;
};
export type PriceRate = {
  id: string;
  stage: "generation" | "vision" | "transcription" | "tts" | "support";
  model: string;
  unit:
    | "input_million_tokens"
    | "output_million_tokens"
    | "audio_minute"
    | "page"
    | "tts_thousand_characters";
  rateMicros: number;
};
export type AdminRun = {
  id: string;
  userId: string;
  title: string | null;
  stage: string;
  state: string;
  lastError: string | null;
  createdAt: string;
  retryAllowed: boolean;
  model?: string | null;
};
export type EmailTemplate = {
  id: string;
  version: string;
  name: LocalizedText;
  subject: LocalizedText;
  body: LocalizedText;
  presentation?: Partial<Record<AdminLocale, EmailPresentationSettings>>;
  variableDefaults?: Partial<Record<AdminLocale, Record<string, string>>>;
};
export type AdminEmail = {
  id: string;
  userId: string;
  email: string;
  subject: string;
  state: string;
  createdAt: string;
  lastError: string | null;
  retryAllowed: boolean;
};
export type FeedbackSummary = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  subject: string;
  category: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  notifyByEmail: boolean;
};
export type FeedbackMessage = {
  id: string;
  author: "learner" | "admin";
  body: string;
  createdAt: string;
  language?: string | null;
};
export type FeedbackThread = FeedbackSummary & {
  messages: FeedbackMessage[];
  replyDraft?: string | null;
};
export type AuditItem = {
  id: string;
  action: string;
  actorId: string;
  reason: string | null;
  createdAt: string;
  subjectId?: string | null;
};
export type PrivacyItem = {
  id: string;
  kind: string;
  state: string;
  createdAt: string;
  lastError?: string | null;
};
export type BackupItem = {
  id: string;
  state: string;
  createdAt: string;
  verifiedAt: string | null;
  restoreDrillAt: string | null;
  lastError: string | null;
};
export type AdminSettings = {
  language: AdminLocale;
  theme: "system" | "light" | "dark";
  senderConfigured: boolean;
  emailProvider: "resend" | "gmail" | null;
  senderEmail: string | null;
  replyTo: string | null;
  appLink: string | null;
  aiConfigured: boolean;
};
export type AdminSnapshot = {
  view: AdminView;
  users?: AdminUser[];
  nextCursor?: string | null;
  user?: AdminUser;
  quota?: AdminQuota;
  pilot?: PilotSummary;
  costs?: AdminCosts;
  counts?: { users: number; pendingFeedback: number; queuedRuns: number; failedEmails: number };
  tasks?: AdminTask[];
  rates?: PriceRate[];
  rateVersion?: string;
  runs?: AdminRun[];
  threads?: FeedbackSummary[];
  thread?: FeedbackThread;
  templates?: EmailTemplate[];
  emails?: AdminEmail[];
  privacy?: PrivacyItem[];
  backups?: BackupItem[];
  audit?: AuditItem[];
  settings?: AdminSettings;
};
export type EmailPreview = {
  previewId: string;
  draftId?: string;
  revision?: number;
  expiresAt: string;
  recipients: {
    userId: string;
    name: string | null;
    email: string;
    language: AdminLocale;
    subject: string;
    body: string;
    presentation?: EmailPresentationPreview | null;
  }[];
  excluded: { userId: string; reason: string }[];
};
export type AdminResult = {
  ok?: boolean;
  message?: string;
  preview?: EmailPreview;
  body?: string;
  source?: "ai" | "template";
  replyPreview?: {
    draftId: string;
    revision: number;
    threadId: string;
    language: AdminLocale;
    body: string;
    emailPreview?: {
      email: string;
      subject: string;
      body: string;
      presentation?: EmailPresentationPreview | null;
    } | null;
  };
  emails?: AdminEmail[];
  thread?: FeedbackThread;
};
