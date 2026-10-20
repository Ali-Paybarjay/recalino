export { cardHtmlToText, safeCardHtml } from "./card-html";
export { assignGeneratedKnowledgeIds, GENERATED_IDENTITY_VERSION } from "./generated-identities";
export { isAnnouncingHeading, statesAssignment } from "./homework-evidence";
export {
  type Claim,
  claimSchema,
  coverageBaseSchema,
  type EvidenceSource,
  isExplanationLanguage,
  KNOWLEDGE_SUMMARY_LIMIT,
  type KnowledgeModel,
  knowledgeModelSchema,
  type LearningItem,
  LKM_SCHEMA_VERSION,
  learningItemSchema,
  locatorSchema,
  matchesExplanationScript,
  modelClaims,
  type SourceCoverage,
  type SourceRef,
  STUDY_PRODUCTION_CEILING,
  sourceCoverageSchema,
  sourceNotUsedReasons,
  sourceRefSchema,
  validateKnowledgeModel,
} from "./schema";
export { buildStudyAnkiText } from "./study-export";
export {
  resolveStudyLocale,
  type StudyLabelKey,
  type StudyLocale,
  studyMessage,
  studyNumber,
  studyText,
  studyWeekday,
} from "./study-locale";
export {
  explanationStudyFields,
  normalizeGeneratedStudyModel,
  persianStudyFields,
  type StudyLessonContext,
  visibleMistakePatterns,
  writtenMistakePatterns,
} from "./study-policy";
export { renderClassNotesHtml, renderStudyCard } from "./study-render";
export {
  type ClassNotes,
  classNotesSchema,
  type ProductionStudyContent,
  productionStudySchema,
  type RecognitionStudyContent,
  recognitionStudySchema,
  type StudyContent,
  studyContentSchema,
  type TaskBlock,
  type TaskGroup,
  taskBlockSchema,
  taskGroupSchema,
} from "./study-schema";
export {
  type StudyLexicalTarget,
  studyComplementNotations,
  studyGrammarTerms,
  studyLexicalTarget,
  studyLexicalTargetMatches,
  studyPronunciationTarget,
  studyPronunciationTargetSchema,
} from "./study-target";
export {
  cleanupAccountKnowledge,
  cleanupSessionKnowledge,
  getLatestVersion,
  getVersion,
  type KnowledgeVersion,
  type KnowledgeVersionReference,
  listAvailableKnowledgeReferences,
  listLatestAvailableKnowledgeVersions,
  listVersions,
  liveKnowledgeVersionIds,
  liveKnowledgeVersionIdsForCleanup,
  ownedKnowledgeVersionSessions,
  publishKnowledgeVersion,
  redactVersionGenerations,
  tombstoneAccountKnowledge,
  tombstoneKnowledge,
} from "./versions";
