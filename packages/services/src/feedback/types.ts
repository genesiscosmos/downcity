/**
 * Feedback 服务公共类型。
 *
 * 关键说明（中文）
 * - 类型集中放在本模块，避免 service/routes/utils 之间互相定义结构
 * - 输入类型使用 unknown 承接 HTTP 边界，统一由 utils 做校验与标准化
 * - 对外返回类型保持 snake_case，与数据库字段和 HTTP JSON 字段一致
 */

/**
 * 反馈处理状态。
 */
export type FeedbackStatus =
  | "open"
  | "reviewing"
  | "replied"
  | "closed";

/**
 * 反馈消息完整记录。
 */
export interface FeedbackMessage extends Record<string, unknown> {
  /** 反馈 ID。 */
  feedback_id: string;
  /** 反馈来源 Bureau。 */
  bureau_id: string;
  /** 反馈提交用户。 */
  user_id: string;
  /** 用户反馈正文。 */
  message: string;
  /** 用户留下的联系方式，未填写时为空字符串。 */
  contact: string;
  /** 反馈处理状态。 */
  status: FeedbackStatus;
  /** 管理员答复内容，未答复时为空字符串。 */
  reply: string;
  /** 答复人标识，未答复时为空字符串。 */
  reply_by: string;
  /** 答复时间 ISO 字符串，未答复时为空字符串。 */
  replied_at: string;
  /** 附加上下文 JSON 字符串。 */
  metadata_json: string;
  /** 创建时间 ISO 字符串。 */
  created_at: string;
  /** 最近更新时间 ISO 字符串。 */
  updated_at: string;
}

/**
 * 用户提交反馈入参。
 */
export interface FeedbackCreateInput extends Record<string, unknown> {
  /** 用户反馈正文。 */
  message: unknown;
  /** 可选联系方式，例如邮箱、微信、Discord。 */
  contact?: unknown;
  /** 可选上下文，例如页面路径、客户端版本、浏览器信息。 */
  meta?: unknown;
}

/**
 * 反馈查询入参。
 */
export interface FeedbackQueryInput extends Record<string, unknown> {
  /** 按 Bureau 过滤。 */
  bureau_id?: unknown;
  /** 按用户过滤。 */
  user_id?: unknown;
  /** 按状态过滤。 */
  status?: unknown;
  /** 返回数量限制。 */
  limit?: unknown;
}

/**
 * 管理员答复反馈入参。
 */
export interface FeedbackReplyInput extends Record<string, unknown> {
  /** 要答复的反馈 ID。 */
  feedback_id: unknown;
  /** 管理员答复内容。 */
  reply: unknown;
  /** 可选答复人标识，未传时使用 admin。 */
  reply_by?: unknown;
}

/**
 * 管理员状态更新入参。
 */
export interface FeedbackStatusUpdateInput extends Record<string, unknown> {
  /** 要更新的反馈 ID。 */
  feedback_id: unknown;
  /** 目标处理状态。 */
  status: unknown;
}

/**
 * 用户提交反馈结果。
 */
export interface FeedbackCreateResult {
  /** 反馈 ID。 */
  feedback_id: string;
  /** 创建后的默认处理状态。 */
  status: FeedbackStatus;
  /** 创建时间 ISO 字符串。 */
  created_at: string;
}

/**
 * 管理员答复反馈结果。
 */
export interface FeedbackReplyResult {
  /** 反馈 ID。 */
  feedback_id: string;
  /** 答复后的处理状态。 */
  status: FeedbackStatus;
  /** 答复时间 ISO 字符串。 */
  replied_at: string;
}

/**
 * 管理员状态更新结果。
 */
export interface FeedbackStatusUpdateResult {
  /** 反馈 ID。 */
  feedback_id: string;
  /** 更新后的处理状态。 */
  status: FeedbackStatus;
  /** 最近更新时间 ISO 字符串。 */
  updated_at: string;
}
