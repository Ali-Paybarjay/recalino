// Public API of the ACC module (account and learning profile). Other modules import only this file.
export {
  type AccountState,
  acceptDocuments,
  accountExists,
  accountRowOf,
  canStartNewProcessing,
  type ExplanationLanguage,
  existingAccountIds,
  GOALS,
  type Goal,
  getAccountState,
  LEVELS,
  type LearningProfile,
  type Level,
  lockAccount,
  lockAccountForCleanup,
  purgeAccountProfile,
  SETUP_STEPS,
  type SetupStep,
  tombstoneAccount,
} from "./account";
export {
  CURRENT_VERSIONS,
  DOCUMENTS,
  type DocumentId,
  type DocumentVersions,
} from "./documents";
export { accPeriodicJobs } from "./jobs";
export { FIRST_LANGUAGES, isFirstLanguage, type LanguageTier, languageTier } from "./languages";
export {
  listTeachingPreferences,
  resetInferredPreferences,
  saveTeachingPreference,
  type TeachingPreference,
  teachingPreferenceKeys,
} from "./preferences";
export { type ProfileChange, profileChangeSchema, updateProfile } from "./profile";
export { liveAccountIdsQuery } from "./projections";
export {
  type AccSettings,
  accSettingsSchema,
  DEFAULT_ACC_SETTINGS,
  readAccSettings,
} from "./settings";
export {
  completeSignIn,
  createSignupIntent,
  purgeExpiredSignupIntents,
  type SignInOutcome,
  type SignupIntent,
} from "./signup";
