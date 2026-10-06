export { safeCardHtml } from "./card-html";
export { assignGeneratedKnowledgeIds, GENERATED_IDENTITY_VERSION } from "./generated-identities";
export {
  type Claim,
  claimSchema,
  type EvidenceSource,
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
export {
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
  tombstoneAccountKnowledge,
  tombstoneKnowledge,
} from "./versions";
