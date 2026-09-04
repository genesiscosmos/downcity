/**
 * Feedback 服务子模块公共入口。
 */

export { FeedbackService } from "./service.js";
export { feedbackMessages } from "./schema.js";
export type {
  FeedbackCreateInput,
  FeedbackCreateResult,
  FeedbackMessage,
  FeedbackQueryInput,
  FeedbackReplyInput,
  FeedbackReplyResult,
  FeedbackStatus,
  FeedbackStatusUpdateInput,
  FeedbackStatusUpdateResult,
} from "./types.js";
