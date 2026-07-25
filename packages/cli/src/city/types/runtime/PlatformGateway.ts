/**
 * CLI/City 平台控制面读取 Agent runtime 状态时使用的宽松类型。
 *
 * 关键点（中文）
 * - 仅承载平台 gateway / control plane 内部使用的结构化类型。
 * - 所有字段保持宽松输入，便于兼容运行时 API 的非强约束数据。
 */
/**
 * chat plugin status 返回中的单渠道状态。
 */
export interface PlatformAgentChatChannelStatus {
  /**
   * 渠道名。
   */
  channel?: unknown;

  /**
   * 是否启用。
   */
  enabled?: unknown;

  /**
   * 是否已完成配置。
   */
  configured?: unknown;

  /**
   * Agent runtime 中该渠道是否处于运行态。
   */
  running?: unknown;

  /**
   * 链接状态文本。
   */
  linkState?: unknown;

  /**
   * 用户可见状态文案。
   */
  statusText?: unknown;

  /**
   * 额外明细。
   */
  detail?: Record<string, unknown>;
}
