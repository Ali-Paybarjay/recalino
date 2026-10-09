export { cardHtmlToText, safeCardHtml } from "./card-html";
export { assignGeneratedKnowledgeIds, GENERATED_IDENTITY_VERSION } from "./generated-identities";
export {
  type Claim,
  claimSchema,
  type EvidenceSource,
  isExplanationLanguage,
  type KnowledgeModel,
  knowledgeModelSchema,
  type LearningItem,
  LKM_SCHEMA_VERSION,
  learningItemSchema,
  locatorSchema,
  matchesExplanationScript,
  modelClaims,
  type SourceRef,
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
  liveKnowledgeVersionIdsForCleanup,
  publishKnowledgeVersion,
  redactVersionGenerations,
  tombstoneAccountKnowledge,
  tombstoneKnowledge,
} from "./versions";
