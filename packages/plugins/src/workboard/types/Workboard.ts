/**
 * Workboard 插件类型定义。
 *
 * 关键点（中文）
 * - workboard 是对外展示面板，类型只保留公开安全的模糊状态。
 * - 不暴露 session_id、路径、模型、service 名称、task 明细等内部信息。
 */

/**
 * Workboard 活动类型。
 */
export type WorkboardActivityKind = "focus" | "progress" | "idle";

/**
 * Workboard 活动状态。
 */
export type WorkboardActivityStatus = "active" | "steady" | "waiting" | "issue";

/**
 * Workboard 信号语气。
 */
export type WorkboardSignalTone = "neutral" | "accent" | "warning";

/**
 * 单个公开活动项。
 */
export interface WorkboardActivityItem {
  /**
   * 活动稳定标识。
   */
  id: string;
  /**
   * 活动类型。
   */
  kind: WorkboardActivityKind;
  /**
   * 对外可展示的模糊标题。
   */
  title: string;
  /**
   * 对外可展示的模糊摘要。
   */
  summary: string;
  /**
   * 当前状态。
   */
  status: WorkboardActivityStatus;
  /**
   * 最近更新时间（ISO8601）。
   */
  updated_at: string;
  /**
   * 对外安全标签。
   */
  tags: string[];
}

/**
 * 单个公开信号项。
 */
export interface WorkboardSignalItem {
  /**
   * 信号名称。
   */
  label: string;
  /**
   * 信号值。
   */
  value: string;
  /**
   * 信号语气。
   */
  tone: WorkboardSignalTone;
}

/**
 * 顶部公开摘要。
 */
export interface WorkboardSummary {
  /**
   * 对外 headline。
   */
  headline: string;
  /**
   * 当前姿态描述。
   */
  posture: string;
  /**
   * 当前动量描述。
   */
  momentum: string;
  /**
   * 可见性说明。
   */
  visibilityNote: string;
}

/**
 * agent 公开摘要。
 */
export interface WorkboardAgentSummary {
  /**
   * agent 展示名称。
   */
  name: string;
  /**
   * 当前 agent 是否运行中。
   */
  running: boolean;
  /**
   * 顶部状态文案。
   */
  statusText: string;
  /**
   * 最近采集时间（ISO8601）。
   */
  collectedAt: string;
}

/**
 * Workboard 快照。
 */
export interface WorkboardSnapshot {
  /**
   * agent 公开摘要。
   */
  agent: WorkboardAgentSummary;
  /**
   * 顶部公开摘要。
   */
  summary: WorkboardSummary;
  /**
   * 当前活动列表。
   */
  current: WorkboardActivityItem[];
  /**
   * 最近活动列表。
   */
  recent: WorkboardActivityItem[];
  /**
   * 模糊信号列表。
   */
  signals: WorkboardSignalItem[];
}

/**
 * Workboard 快照响应。
 */
export interface WorkboardSnapshotResponse {
  /**
   * 请求是否成功。
   */
  success: boolean;
  /**
   * 当前快照。
   */
  snapshot: WorkboardSnapshot;
}
