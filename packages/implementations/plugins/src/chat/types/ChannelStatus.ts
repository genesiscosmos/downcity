/**
 * Chat 渠道运行状态与连通性测试类型。
 *
 * 关键点（中文）
 * - 统一 `status/test/reconnect` 的返回结构，供 CLI 与 Console 复用。
 * - 字段保持稳定，避免前端按渠道分支解析。
 */

/**
 * 支持的 chat 渠道名称。
 */
export type ChatChannelName = "telegram" | "feishu" | "qq";

/**
 * 渠道链路状态枚举。
 */
export type ChatLinkState = "connected" | "disconnected" | "unknown";

/**
 * 渠道诊断字段值类型。
 *
 * 关键点（中文）
 * - 允许嵌套对象与数组，便于挂载 `detail.configuration.fields` 这类结构化元信息。
 * - 仅允许 JSON 可序列化基础类型，避免传递运行时函数等不可持久化值。
 */
export type ChatChannelDetailValue =
  | string
  | number
  | boolean
  | null
  | ChatChannelDetailValue[]
  | {
      [key: string]: ChatChannelDetailValue;
    };

/**
 * 单个渠道的状态快照。
 */
export type ChatChannelStateSnapshot = {
  /**
   * 渠道名称（telegram/feishu/qq）。
   */
  channel: ChatChannelName;
  /**
   * 当前运行态是否启用该渠道。
   */
  enabled: boolean;
  /**
   * 必要鉴权配置是否完整（例如 token/appId/appSecret）。
   */
  configured: boolean;
  /**
   * 当前进程内该渠道实例是否处于活动状态。
   */
  running: boolean;
  /**
   * 当前链路状态（已连接/未连接/未知）。
   */
  linkState: ChatLinkState;
  /**
   * 状态描述文本（用于面板展示与排障提示）。
   */
  statusText: string;
  /**
   * 渠道附加诊断信息（仅用于可视化，不承诺结构稳定）。
   */
  detail?: Record<string, ChatChannelDetailValue>;
};

/**
 * 单个渠道连通性测试结果。
 */
export type ChatChannelTestResult = {
  /**
   * 渠道名称。
   */
  channel: ChatChannelName;
  /**
   * 测试是否通过。
   */
  success: boolean;
  /**
   * 测试执行时间（Unix 毫秒时间戳）。
   */
  testedAtMs: number;
  /**
   * 测试耗时（毫秒）。
   */
  latencyMs?: number;
  /**
   * 测试结果说明。
   */
  message: string;
  /**
   * 附加诊断信息（例如 bot 用户名、ws readyState）。
   */
  detail?: Record<string, ChatChannelDetailValue>;
};
