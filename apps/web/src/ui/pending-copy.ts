/**
 * Interface text added after the design handoff and not yet approved by the product owner.
 * Every entry is registered verbatim in docs/design/UI_COPY_PENDING.md; pending-copy.test.ts
 * keeps the two in step. Once approved, an entry moves to its screen's copy and the register.
 */
import { lessonQualityCopy } from "./workspace/lesson-quality-copy";

export const pendingCopy: Record<string, unknown> = {
  lessonQuality: lessonQualityCopy,
};
