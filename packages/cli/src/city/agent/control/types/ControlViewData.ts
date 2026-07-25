/**
 * Control UI 数据视图类型定义。
 *
 * 关键点（中文）
 * - 统一承载 single-agent control API 的内部视图数据结构。
 * - 仅描述 control UI 所需的投影视图，不包含底层上下文原始协议类型。
 */

import type { JsonObject } from "@downcity/agent";

/**
 * Control 时间线消息角色。
 */
export type ControlTimelineRole =
  | "user"
  | "assistant"
  | "tool-call"
  | "tool-result"
  | "system"
  | "action";

/**
 * Control 时间线事件。
 */
export interface ControlTimelineEvent {
  /**
   * 事件唯一标识。
   */
  id: string;

  /**
   * 事件角色。
   */
  role: ControlTimelineRole;

  /**
   * 事件时间戳（毫秒）。
   */
  ts?: number;

  /**
   * 事件类型。
   */
  kind?: string;

  /**
   * 事件来源。
   */
  source?: string;

  /**
   * 展示文本。
   */
  text: string;

  /**
   * 工具名称。
   */
  tool_name?: string;

  /**
   * action 标题。
   */
  action_title?: string;

  /**
   * action 描述。
   */
  action_description?: string;

  /**
   * action 状态。
   */
  action_state?: string;
}

/**
 * Control 会话摘要。
 */
export interface ControlSessionSummary {
  /**
   * 会话 ID。
   *
   * 说明（中文）
   * - 对内对外统一使用 `session_id` 语义。
   */
  session_id: string;

  /**
   * 消息数量。
   */
  message_count: number;

  /**
   * 最后更新时间（毫秒）。
   */
  updated_at?: number;

  /**
   * 最后一条消息角色。
   */
  lastRole?: "user" | "assistant" | "system" | "action";

  /**
   * 最后一条消息摘要。
   */
  lastText?: string;

  /**
   * 渠道名。
   */
  channel?: string;

  /**
   * 聊天对象 id。
   */
  chatId?: string;

  /**
   * 聊天标题。
   */
  chatTitle?: string;

  /**
   * 聊天类型。
   */
  chatType?: string;

  /**
   * 线程 id。
   */
  threadId?: number;

  /**
   * 当前 session 是否正在执行。
   */
  executing?: boolean;
}

/**
 * Control 日志项。
 */
export interface ControlLogEntry {
  /**
   * 日志时间。
   */
  timestamp?: string;

  /**
   * 日志类型。
   */
  type?: string;

  /**
   * 日志级别。
   */
  level?: string;

  /**
   * 日志消息。
   */
  message?: string;

  /**
   * 结构化详情。
   */
  details?: JsonObject;
}

/**
 * Control 任务运行摘要。
 */
export interface ControlTaskRunSummary {
  /**
   * 运行时间戳目录名。
   */
  timestamp: string;

  /**
   * 综合状态。
   */
  status?: string;

  /**
   * 执行状态。
   */
  executionStatus?: string;

  /**
   * 结果状态。
   */
  resultStatus?: string;

  /**
   * 是否仍在运行。
   */
  inProgress?: boolean;

  /**
   * 当前阶段。
   */
  progressPhase?: string;

  /**
   * 进度消息。
   */
  progressMessage?: string;

  /**
   * 进度更新时间。
   */
  progressUpdatedAt?: number;

  /**
   * 当前轮次。
   */
  progressRound?: number;

  /**
   * 最大轮次。
   */
  progressMaxRounds?: number;

  /**
   * 开始时间。
   */
  startedAt?: number;

  /**
   * 结束时间。
   */
  endedAt?: number;

  /**
   * 对话轮数。
   */
  dialogueRounds?: number;

  /**
   * user simulator 是否满意。
   */
  userSimulatorSatisfied?: boolean;

  /**
   * 错误消息。
   */
  error?: string;

  /**
   * 相对项目根目录的运行目录路径。
   */
  runDirRel: string;
}

/**
 * Control 任务运行详情。
 */
export interface ControlTaskRunDetail {
  /**
   * 任务标题。
   */
  title: string;

  /**
   * 运行时间戳目录名。
   */
  timestamp: string;

  /**
   * 相对项目根目录的运行目录路径。
   */
  runDirRel: string;

  /**
   * 运行元数据。
   */
  meta?: Record<string, unknown>;

  /**
   * 运行进度快照。
   */
  progress?: {
    /**
     * 进度状态。
     */
    status?: string;

    /**
     * 当前阶段。
     */
    phase?: string;

    /**
     * 进度消息。
     */
    message?: string;

    /**
     * 开始时间。
     */
    startedAt?: number;

    /**
     * 更新时间。
     */
    updated_at?: number;

    /**
     * 结束时间。
     */
    endedAt?: number;

    /**
     * 当前轮次。
     */
    round?: number;

    /**
     * 最大轮次。
     */
    maxRounds?: number;

    /**
     * 运行状态。
     */
    runStatus?: string;

    /**
     * 执行状态。
     */
    executionStatus?: string;

    /**
     * 结果状态。
     */
    resultStatus?: string;

    /**
     * 进度事件列表。
     */
    events?: Array<{
      /**
       * 事件时间。
       */
      at?: number;

      /**
       * 阶段。
       */
      phase?: string;

      /**
       * 消息。
       */
      message?: string;

      /**
       * 轮次。
       */
      round?: number;

      /**
       * 最大轮次。
       */
      maxRounds?: number;
    }>;
  };

  /**
   * 对话产物。
   */
  dialogue?: Record<string, unknown>;

  /**
   * 产物文件摘要。
   */
  artifacts: {
    /**
     * 输入文档内容。
     */
    input?: string;

    /**
     * 输出文档内容。
     */
    output?: string;

    /**
     * 结果文档内容。
     */
    result?: string;

    /**
     * 对话文档内容。
     */
    dialogue?: string;

    /**
     * 错误文档内容。
     */
    error?: string;
  };

  /**
   * 运行消息时间线。
   */
  messages: ControlTimelineEvent[];
}
