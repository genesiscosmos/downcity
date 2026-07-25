/**
 * Agent session 数据类型。
 *
 * 关键点（中文）
 * - 只描述 session 的输入、摘要、历史、system snapshot 与配置快照。
 * - session actor 方法接口拆到 `SessionActor.ts`。
 */

import type { AgentModel } from "@/agent/AgentModel.js";

/**
 * 新建 session 的输入参数。
 */
export interface AgentCreateSessionInput {
  /**
   * 可选显式 sessionId。
   *
   * 关键点（中文）
   * - 传入时表达“创建意图”。
   * - 若该 session 已存在，SDK 应直接报错，而不是静默复用。
   * - 省略时由 SDK 自动生成稳定且不可推导的 sessionId。
   */
  sessionId?: string;

}

/**
 * Session 列表查询输入。
 */
export interface AgentListSessionsInput {
  /**
   * 当前页返回上限。
   *
   * 说明（中文）
   * - 省略时由 SDK 使用默认值。
   * - 建议宿主 UI 明确传入，避免在大量 session 下拉取过多数据。
   */
  limit?: number;

  /**
   * 分页游标。
   *
   * 说明（中文）
   * - 当前使用 SDK 自身生成的透明字符串游标。
   * - 调用方只负责透传，不应自行解析其内部格式。
   */
  cursor?: string;

  /**
   * 关键词过滤。
   *
   * 说明（中文）
   * - 推荐用于匹配 `sessionId`、标题与预览文本。
   * - 属于轻量包含匹配，不承诺复杂搜索语义。
   */
  query?: string;
}

/**
 * Session 可变配置。
 */
export interface AgentSessionSetInput {
  /**
   * 当前 session 默认模型实例。
   *
   * 关键点（中文）
   * - SDK 只接受宿主已经解析完成的运行时模型实例。
   * - 模型选择、ID 与持久化全部由宿主负责。
   */
  model: AgentModel;
}

/**
 * Session 当前配置快照。
 */
export interface AgentSessionConfigSnapshot {
  /** 当前 session 绑定的默认模型实例。 */
  model?: AgentModel;
  /** 当前模型的轻量可读标签。 */
  modelLabel?: string;
  /** 当前模型支持的总上下文窗口长度，单位为 token。 */
  model_context_window?: number;
}

/**
 * Session 时间线事件。
 */
export interface AgentSessionTimelineEvent {
  /** 当前事件唯一标识。 */
  id: string;
  /**
   * 当前事件角色。
   *
   * 说明（中文）
   * - `tool-call` / `tool-result` 用于把 assistant 内部工具过程平铺给 UI。
   */
  role: "user" | "assistant" | "tool-call" | "tool-result" | "action";
  /** 事件时间戳（毫秒）。 */
  ts?: number;
  /** 事件所属消息种类。 */
  kind?: string;
  /** 事件来源。 */
  source?: string;
  /** 当前事件展示文本。 */
  text: string;
  /**
   * 当前事件对应工具名称。
   *
   * 说明（中文）
   * - 仅 `tool-call` / `tool-result` 这类事件通常会携带该字段。
   */
  toolName?: string;
  /**
   * 当前 action 标题。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  actionTitle?: string;
  /**
   * 当前 action 描述。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  actionDescription?: string;
  /**
   * 当前 action 状态。
   *
   * 说明（中文）
   * - 仅 `role=action` 的事件通常会携带该字段。
   */
  actionState?: string;
}

/**
 * Session system block 来源类型。
 */
export type AgentSessionSystemBlockSource =
  | "core"
  | "instruction"
  | "plugin"
  | "session";

/**
 * Session system prompt 的单个组成块。
 */
export interface AgentSessionSystemBlock {
  /** 当前 block 的来源层级。 */
  source: AgentSessionSystemBlockSource;
  /**
   * 当前 block 在来源层级内的名称。
   *
   * 说明（中文）
   * - `instruction` 通常使用 `agent`。
   * - `plugin` 使用对应 plugin 名称。
   * - `core` 使用 `default`。
   * - `session` 使用当前 session 上下文名称。
   */
  name: string;
  /**
   * 已归一化后的 system 文本内容。
   *
   * 关键点（中文）
   * - SDK 不对 instruction 做动态变量替换。
   * - 动态上下文应由调用方放入 user message。
   */
  content: string;
}

/**
 * 当前 session 的稳定上下文信息。
 */
export interface AgentSessionSystemSessionInfo {
  /** 当前 session 所属 agentId。 */
  agentId: string;
  /** 当前 session 唯一标识。 */
  sessionId: string;
  /** 当前 agent 绑定的项目根目录。 */
  projectRoot: string;
  /**
   * 当前 session 首次创建时间。
   *
   * 关键点（中文）
   * - 这是 session 初始化时落盘的稳定参考时间，按 Date/ISO 字符串对外展示。
   * - 它不是每轮运行的当前时间，不会随着后续 turn 执行而改变。
   */
  createdAt: string;
  /**
   * 当前 session 初始化时解析到的系统时区。
   *
   * 关键点（中文）
   * - 这是 session 级参考时区，随创建信息一起固定。
   * - 它不是每轮运行重新解析的动态时区。
   */
  timezone: string;
}

/**
 * 当前 session 首次生成后固定的完整 system prompt 快照。
 */
export interface AgentSessionSystemSnapshot {
  /** 当前 sessionId。 */
  sessionId: string;
  /**
   * 当前 session 的稳定上下文信息。
   *
   * 关键点（中文）
   * - 这里包含 session 创建时间这类稳定参考信息。
   * - 这里不包含当前时间、轮次、用户输入等每轮变化的数据。
   * - 每轮动态信息应由调用方放入 user message，避免破坏 instruction 缓存命中。
   */
  session: AgentSessionSystemSessionInfo;
  /** 首次生成后固定的 system blocks，按进入模型的顺序排列。 */
  blocks: AgentSessionSystemBlock[];
}

/**
 * Session 摘要。
 */
export interface AgentSessionSummary {
  /** 当前 session 所属 agentId。 */
  agentId: string;
  /** 当前 session 唯一标识。 */
  sessionId: string;
  /**
   * 当前 session 可读标题。
   *
   * 说明（中文）
   * - 标题持久化在 session `meta.json` 顶层。
   * - SDK 只在模型成功生成标题时写入，不再从首条用户消息生成 fallback。
   * - 标题允许为空，调用方需要展示占位文案时可自行回退到 `sessionId`。
   */
  title?: string;
  /**
   * 当前 session 的最近预览文本。
   *
   * 说明（中文）
   * - 通常来自最后一条用户可见消息的裁剪文本。
   * - 适合用于侧边栏、列表卡片或 session picker。
   */
  previewText?: string;
  /** 当前 session 首次创建时间（ms）。 */
  createdAt?: number;
  /** 当前 session 最近一次更新时间（ms）。 */
  updatedAt?: number;
  /** 当前 session 已落盘消息数。 */
  messageCount: number;
  /** 当前 session 绑定模型的可读标签。 */
  modelLabel?: string;
  /** 当前 session 是否处于执行中。 */
  executing?: boolean;
}

/**
 * Session 详情。
 */
export interface AgentSessionInfo extends AgentSessionSummary {
  /** 当前 session 初始化时记录的时区。 */
  timezone?: string;
}

/**
 * Session 摘要分页结果。
 */
export interface AgentSessionSummaryPage {
  /** 当前页 session 摘要列表。 */
  items: AgentSessionSummary[];
  /**
   * 当前页所对应的总条数。
   *
   * 说明（中文）
   * - 这里表示过滤后的总数，不是仅当前页数量。
   * - 对分页 UI、结果统计和空态判断更友好。
   */
  total: number;
  /** 下一页游标。 */
  nextCursor?: string;
  /** 是否仍有更多结果。 */
  hasMore: boolean;
}

/**
 * Session fork 输入。
 */
export interface AgentSessionForkInput {
  /**
   * 可选分叉锚点消息 ID。
   *
   * 关键点（中文）
   * - 省略时复制当前 session 的完整消息历史。
   * - 传入时复制到该消息为止（包含该消息）。
   */
  messageId?: string;
}

/**
 * 归档单个 session 的输入参数。
 */
export interface AgentArchiveSessionInput {
  /**
   * 要归档的 session id。
   *
   * 关键点（中文）
   * - 必须指向当前 agent 下已存在的未归档 session。
   * - 正在执行中的 session 不允许归档。
   */
  id: string;
}

/**
 * 列出已归档 session 的输入参数。
 */
export interface AgentArchiveSessionsInput {
  /**
   * 当前页返回上限。
   *
   * 说明（中文）
   * - 省略时由 SDK 使用默认值。
   */
  limit?: number;

  /**
   * 分页游标。
   *
   * 说明（中文）
   * - 当前使用 SDK 自身生成的透明字符串游标。
   * - 调用方只负责透传，不应自行解析其内部格式。
   */
  cursor?: string;

  /**
   * 关键词过滤。
   *
   * 说明（中文）
   * - 推荐用于匹配 `sessionId`、标题与预览文本。
   * - 属于轻量包含匹配，不承诺复杂搜索语义。
   */
  query?: string;
}

/**
 * 归档单个 session 的结果。
 */
export interface AgentArchiveSessionResult {
  /** 被归档的 session id。 */
  sessionId: string;
  /** 归档时间戳（ms）。 */
  archivedAt: number;
}

/**
 * 列出已归档 session 的结果。
 */
export interface AgentArchiveSessionsResult extends AgentSessionSummaryPage {}

/**
 * 清空归档目录的结果。
 */
export interface AgentCleanArchiveResult {
  /** 被永久删除的归档 session id 列表。 */
  removedSessionIds: string[];
}
